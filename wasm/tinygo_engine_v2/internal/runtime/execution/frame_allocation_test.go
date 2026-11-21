package execution

import "tinygo_engine_v2/internal/runtime/contract"

import actionpkg "tinygo_engine_v2/internal/runtime/action"

import (
	"maps"
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/scheduler"
)

// 测试需要同时持有多个帧，生产入口直接初始化调用方局部对象。
func (s *Engine) newExecutionFrame(sourceKey, targetKey, abilityRef string) *Frame {
	frame := &Frame{}
	s.initExecutionFrame(frame, sourceKey, targetKey, abilityRef)
	return frame
}

func testCooldownEntries(ledger *actionpkg.CooldownLedger) map[contract.CooldownIdentity]contract.CooldownEntry {
	if ledger == nil {
		return nil
	}
	out := make(map[contract.CooldownIdentity]contract.CooldownEntry, ledger.EntryCount())
	for slot := 0; slot < ledger.EntryCount(); slot++ {
		id, value := ledger.EntryAt(slot)
		out[id] = value
	}
	return out
}

func TestFrameAllocationCooldownNilAndZeroKeepPresence(t *testing.T) {
	for _, initial := range []struct {
		name   string
		values map[string]int64
	}{
		{name: "nil"},
		{name: "empty", values: map[string]int64{}},
		{name: "zero", values: map[string]int64{"existing": 0}},
	} {
		t.Run(initial.name, func(t *testing.T) {
			state := attributeOwnershipState(t, 1000)
			live := state.combatants["source"]
			live.cooldowns = nil
			if initial.values != nil {
				live.cooldowns = actionpkg.CooldownLedgerFromDeadlines("source", initial.values)
			}
			initialEntries := testCooldownEntries(live.cooldowns)
			state.combatants["source"] = live
			frame := state.newExecutionFrame("source", "target", "")
			frozen := frame.stageFor("source").readonlyCooldowns()
			before := testCooldownEntries(frozen)
			if err := frame.applyCooldownChange("source", "inserted", 0); err != nil {
				t.Fatal(err)
			}
			if value, exists := frame.stageFor("source").cooldowns.Entry(actionpkg.AbilityCooldownIdentity("source", "inserted")); !exists || value.ReadyAt != 0 {
				t.Fatal("zero cooldown lost its explicit key")
			}
			if !reflect.DeepEqual(testCooldownEntries(frozen), before) || !reflect.DeepEqual(testCooldownEntries(state.combatants["source"].cooldowns), initialEntries) {
				t.Fatal("cooldown write changed a prior or live view")
			}
			frame.commit()
			if frame.fatal || !frame.committed {
				t.Fatal(frame.fatalErr)
			}
			published := state.combatants["source"].cooldowns
			if value, exists := published.Entry(actionpkg.AbilityCooldownIdentity("source", "inserted")); !exists || value.ReadyAt != 0 {
				t.Fatal("commit dropped the explicit zero cooldown")
			}
			if _, existed := initial.values["existing"]; existed {
				if value, exists := published.Entry(actionpkg.AbilityCooldownIdentity("source", "existing")); !exists || value.ReadyAt != 0 {
					t.Fatal("commit dropped the original zero cooldown")
				}
			}
			if err := frame.applyCooldownChange("source", "inserted", 500); err != nil {
				t.Fatal(err)
			}
			if published.AbilityReadyAt("source", "inserted") != 0 || !reflect.DeepEqual(testCooldownEntries(frozen), before) {
				t.Fatal("post-commit frame write changed a published cooldown view")
			}
		})
	}
	// 未借出过只读视图的空暂存对象也必须允许首次写入。
	var staged stagedCombatant
	staged.writableCooldowns().Set(actionpkg.AbilityCooldownIdentity("", "first"), 0, 0)
	if value, exists := staged.cooldowns.Entry(actionpkg.AbilityCooldownIdentity("", "first")); !exists || value.ReadyAt != 0 {
		t.Fatal("first write to an unshared nil cooldown table failed")
	}
}

func TestFrameAllocationCooldownChildCommitAndFailedParentKeepViews(t *testing.T) {
	state := attributeOwnershipState(t, 1000)
	live := state.combatants["source"]
	live.cooldowns = actionpkg.CooldownLedgerFromDeadlines("source", map[string]int64{"control": 1000, "zero": 0})
	state.combatants["source"] = live
	parent := state.newExecutionFrame("source", "target", "parent")
	parentView := parent.stageFor("source").readonlyCooldowns()
	parentEntries := testCooldownEntries(parentView)
	child := state.newExecutionFrame("target", "source", "child")
	if err := child.applyCooldownChange("source", "control", 700); err != nil {
		t.Fatal(err)
	}
	child.commit()
	if child.fatal || !child.committed || state.combatants["source"].cooldowns.AbilityReadyAt("source", "control") != 700 || parentView.AbilityReadyAt("source", "control") != 1000 {
		t.Fatal("child commit changed the older parent view", child.fatalErr)
	}
	published := state.combatants["source"].cooldowns
	publishedEntries := testCooldownEntries(published)
	if err := parent.applyCooldownChange("source", "control", 800); err != nil {
		t.Fatal(err)
	}
	if published.AbilityReadyAt("source", "control") != 700 || parentView.AbilityReadyAt("source", "control") != 1000 {
		t.Fatal("parent write changed a committed child or older readonly view")
	}
	clearQueuedEventsForTest(state.loop)
	state.loop.SetQueueLimit(1)
	if state.loop.Enqueue(scheduler.GenericEvent{TimeMs: 1000}) != model.ErrOK {
		t.Fatal("queue setup failed")
	}
	parent.pendingStateExpiry = []pendingFrameStateExpiry{{at: 2000}}
	parent.commit()
	if !parent.fatal || parent.fatalErr == nil || parent.fatalErr.BudgetCause != model.BudgetCauseMaxQueueEvents || parent.committed {
		t.Fatal("parent did not fail at queue preflight", parent.fatalErr)
	}
	if !reflect.DeepEqual(testCooldownEntries(published), publishedEntries) || !reflect.DeepEqual(testCooldownEntries(parentView), parentEntries) {
		t.Fatal("failed parent published its cooldown writes")
	}
	if err := child.applyCooldownChange("source", "control", 900); err != nil {
		t.Fatal(err)
	}
	child.commit()
	if published.AbilityReadyAt("source", "control") != 700 || state.combatants["source"].cooldowns.AbilityReadyAt("source", "control") != 700 {
		t.Fatal("an already committed frame rewrote live cooldowns")
	}
}

func TestFrameAllocationWaitContextResetsAndKeepsAttackDirection(t *testing.T) {
	for _, direction := range []struct {
		name, source, target string
	}{
		{"forward", "source", "target"},
		{"reverse", "target", "source"},
		{"self", "target", "target"},
	} {
		t.Run(direction.name, func(t *testing.T) {
			state := waitingTestState(t)
			frame := state.newExecutionFrame(direction.source, direction.target, "unrelated")
			source := frame.stageFor("source")
			var context Frame
			context.fatal, context.committed, context.skipBlockedWrites = true, true, true
			context.eventCtx = &eventFormulaSnapshot{EventType: "stale"}
			context.processActualCosts = model.BorrowNumericView(map[string]float64{"mana": 10})
			context.processCostReadable = true
			context.actionFrame.StageAttackWait(state.actions.BasicAttack().Wait())
			if err := frame.basicAttackWaitContext(&context); err != nil {
				t.Fatal(err)
			}
			if context.sourceKey != "source" || context.targetKey != "target" || context.ownerCombatantKey != "source" || context.ownerProviderRef != "attack" || context.abilityRef != state.actions.BasicAttack().Plan().InitialControlAbilityRef || !context.strictReads {
				t.Fatal("waiting context inherited an unrelated frame direction or owner")
			}
			if context.fatal || context.committed || context.skipBlockedWrites || context.eventCtx != nil || context.processActualCosts.Present() || context.processCostReadable || context.actionFrame.AttackWait() != nil {
				t.Fatal("reused waiting context retained stale execution state")
			}
			if context.stageFor("source") != source {
				t.Fatal("ordinary waiting context detached the parent's staging")
			}
			target := context.stageFor("target")
			if frame.staged.Get("target") != target {
				t.Fatal("combatant first staged by waiting context was not added to parent")
			}
			if err := context.applyCooldownChange("target", "zero", 0); err != nil {
				t.Fatal(err)
			}
			if _, exists := frame.staged.Get("target").cooldowns.Entry(actionpkg.AbilityCooldownIdentity("target", "zero")); !exists {
				t.Fatal("waiting context lost the ordinary shared staging write")
			}
			if _, exists := state.combatants["target"].cooldowns.Entry(actionpkg.AbilityCooldownIdentity("target", "zero")); exists {
				t.Fatal("waiting context published before parent commit")
			}
		})
	}
}

func frameAllocationWaitingProviderState(t *testing.T) *Engine {
	t.Helper()
	input, request := continuousAttackInput(1, 10000, 0, 0, 0, 4000)
	request.DriverPlan.BasicAttack.AttackSpeedInputMax = 10
	input.SharedProviders = append(input.SharedProviders, model.ProviderDefinition{
		ProviderKey: "waiting-speed", StableID: "waiting-speed", Kind: "status",
		Modifiers: []model.ModifierDefinition{{ModifierKey: "speed", Kind: "attribute", Target: "self.attr.attack_speed", ValuePolicy: "add", Value: authoringConst(1)}},
	})
	state, err := newGenericRunState(authoringCompile(t, input), request)
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := takeNextEventForTest(state.loop); !exists {
		t.Fatal("missing first attack")
	}
	if err := state.handleBasicAttack(); err != nil {
		t.Fatal(err)
	}
	state.loop.Advance(400)
	return state
}

func TestFrameAllocationWaitProviderPreviewAndCooldownWritesStayIndependent(t *testing.T) {
	state := frameAllocationWaitingProviderState(t)
	control := state.actions.BasicAttack().Plan().InitialControlAbilityRef
	frame := state.newExecutionFrame("target", "source", "speed-change")
	source := frame.stageFor("source")
	if err := frame.applyCooldownChange("source", "auxiliary", 0); err != nil {
		t.Fatal(err)
	}
	source.providerOps = []stagedProviderMutation{{Kind: "apply", DefinitionRef: "waiting-speed", SourceKey: "source", TargetKey: "source"}}
	parentVersion := source.cooldowns
	var preview Frame
	if err := frame.basicAttackWaitContext(&preview); err != nil {
		t.Fatal(err)
	}
	previewSource := preview.stageFor("source")
	if previewSource == source || previewSource.attributesView().At("attack_speed").Resolved != 2 || source.attributesView().At("attack_speed").Resolved != 1 || state.combatants["source"].attributesView().At("attack_speed").Resolved != 1 {
		t.Fatal("provider preview did not isolate the changed speed")
	}
	if err := preview.applyCooldownChange("source", "auxiliary", 50); err != nil {
		t.Fatal(err)
	}
	if source.cooldowns.AbilityReadyAt("source", "auxiliary") != 0 || parentVersion.AbilityReadyAt("source", "auxiliary") != 0 {
		t.Fatal("preview cooldown write changed the parent's view")
	}
	if err := frame.applyCooldownChange("source", "auxiliary", 60); err != nil {
		t.Fatal(err)
	}
	if previewSource.cooldowns.AbilityReadyAt("source", "auxiliary") != 50 || parentVersion.AbilityReadyAt("source", "auxiliary") != 0 {
		t.Fatal("parent cooldown write changed a preview or prior view")
	}
	if _, err := frame.prepareBasicAttackWait(); err != nil {
		t.Fatal(err)
	}
	wait := frame.actionFrame.AttackWait()
	if wait == nil || basicAttackProgressDeadline(wait) != 700 || wait.SourceAttributes().At("attack_speed").Resolved != 2 || source.cooldowns.AbilityReadyAt("source", control) != 700 || state.basicAttackReadyAt() != 1000 || state.combatants["source"].cooldowns.AbilityReadyAt("source", control) != 1000 {
		t.Fatal("waiting preflight did not stage the provider-adjusted cooldown", wait)
	}
	if parentVersion.AbilityReadyAt("source", control) != 1000 || previewSource.cooldowns.AbilityReadyAt("source", control) != 1000 {
		t.Fatal("waiting preflight changed a prior readonly cooldown view")
	}
	frame.commit()
	if frame.fatal || !frame.committed || state.basicAttackReadyAt() != 700 || state.combatants["source"].cooldowns.AbilityReadyAt("source", control) != 700 || state.combatants["source"].attributesView().At("attack_speed").Resolved != 2 {
		t.Fatal("provider and adjusted waiting clock did not commit together", frame.fatalErr)
	}
	providerRef := ""
	for instanceIndex, instanceValues := 0, state.combatants["source"].instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
		provider := instanceValues.At(instanceIndex)
		if provider.DefinitionRef == "waiting-speed" {
			providerRef = provider.ProviderRef
		}
	}
	if providerRef == "" {
		t.Fatal("committed waiting provider is missing")
	}
	state.loop.Advance(500)
	remove := state.newExecutionFrame("source", "source", "speed-expire")
	remove.stageFor("source").providerOps = []stagedProviderMutation{{Kind: "expire", ProviderRef: providerRef, TargetKey: "source"}}
	if _, err := remove.prepareBasicAttackWait(); err != nil {
		t.Fatal(err)
	}
	if remove.actionFrame.AttackWait() == nil || basicAttackProgressDeadline(remove.actionFrame.AttackWait()) != 900 || remove.stageFor("source").attributesView().At("attack_speed").Resolved != 2 || state.basicAttackReadyAt() != 700 || wait.SourceAttributes().At("attack_speed").Resolved != 2 {
		t.Fatal("provider removal preview changed an older frame or waiting snapshot")
	}
	remove.commit()
	if remove.fatal || state.basicAttackReadyAt() != 900 || state.combatants["source"].attributesView().At("attack_speed").Resolved != 1 || basicAttackProgressDeadline(wait) != 700 || wait.SourceAttributes().At("attack_speed").Resolved != 2 {
		t.Fatal("provider removal changed an earlier waiting snapshot", remove.fatalErr)
	}
}

func TestFrameAllocationFailedWaitProviderPreviewDoesNotPublish(t *testing.T) {
	state := waitingTestState(t)
	frame := state.newExecutionFrame("source", "target", "bad-provider")
	control := state.actions.BasicAttack().Plan().InitialControlAbilityRef
	before := testCooldownEntries(state.combatants["source"].cooldowns)
	wait := state.actions.BasicAttack().Wait()
	if err := frame.applyCooldownChange("source", control, 800); err != nil {
		t.Fatal(err)
	}
	frame.stageFor("source").providerOps = []stagedProviderMutation{{Kind: "apply", DefinitionRef: "missing", SourceKey: "source", TargetKey: "source"}}
	frame.commit()
	if !frame.fatal || frame.fatalErr == nil || frame.committed || state.actions.BasicAttack().Wait() != wait || !reflect.DeepEqual(testCooldownEntries(state.combatants["source"].cooldowns), before) {
		t.Fatal("failed provider preview published cooldown or waiting changes", frame.fatalErr)
	}
}

func TestWaitPreviewStrictRemovalIsNotProjectedTwiceOrPublishedToParent(t *testing.T) {
	state := frameAllocationWaitingProviderState(t)
	apply := state.newExecutionFrame("source", "source", "install-speed")
	apply.stageFor("source").providerOps = []stagedProviderMutation{{Kind: "apply", DefinitionRef: "waiting-speed", SourceKey: "source", TargetKey: "source"}}
	apply.commit()
	if apply.fatal {
		t.Fatal(apply.fatalErr)
	}
	reference := ""
	for i, values := 0, state.combatants["source"].instances.Providers(); i < values.Len(); i++ {
		if instance := values.At(i); instance.DefinitionRef == "waiting-speed" {
			reference = instance.ProviderRef
		}
	}
	if reference == "" {
		t.Fatal("missing installed provider")
	}
	// 即使快照定义未被当前操作使用，整场标志也会开启帧投影读取。
	state.compiled.Features |= planbundle.FeatureModifierSnapshots
	remove := state.newExecutionFrame("source", "source", "strict-remove")
	parent := remove.stageFor("source")
	parent.providerOps = []stagedProviderMutation{{Kind: "expire", ProviderRef: reference, DefinitionRef: "waiting-speed", SourceKey: "source", TargetKey: "source", Strict: true}}
	var preview Frame
	if err := remove.basicAttackWaitContext(&preview); err != nil {
		t.Fatal(err)
	}
	if _, _, found := preview.stageFor("source").instances.Providers().Find(reference); found {
		t.Fatal("preview did not remove the provider")
	}
	if _, _, found := parent.instances.Providers().Find(reference); !found || parent.providerOps[0].Projected {
		t.Fatal("preview consumed or marked the parent's strict removal")
	}
	if parent.attributesView().At("attack_speed").Resolved != 2 || preview.stageFor("source").attributesView().At("attack_speed").Resolved != 1 {
		t.Fatal("preview did not preserve independent attributes")
	}
	remove.commit()
	if remove.fatal || !remove.committed || state.combatants["source"].attributesView().At("attack_speed").Resolved != 1 || state.basicAttackReadyAt() != 1000 {
		t.Fatal("parent strict removal or waiting cadence did not commit once", remove.fatalErr)
	}
	if _, _, found := state.combatants["source"].instances.Providers().Find(reference); found {
		t.Fatal("parent did not consume the actual instance")
	}
}

func TestWaitPreviewRepairDoesNotAcceptActuallyMissingStrictInstance(t *testing.T) {
	state := frameAllocationWaitingProviderState(t)
	state.compiled.Features |= planbundle.FeatureModifierSnapshots
	frame := state.newExecutionFrame("source", "source", "missing-strict")
	frame.stageFor("source").providerOps = []stagedProviderMutation{{Kind: "expire", ProviderRef: "missing", TargetKey: "source", Strict: true}}
	frame.commit()
	if !frame.fatal || frame.fatalErr == nil || frame.fatalErr.Code != model.GenericErrUnknownRef || frame.committed || state.combatants["source"].attributesView().At("attack_speed").Resolved != 1 {
		t.Fatal("missing actual instance was accepted or published", frame.fatalErr)
	}
}

func TestFrameAllocationCommitKeysUseLocalBufferAndLexicalOrder(t *testing.T) {
	for _, scenario := range []struct {
		name        string
		names, want []string
	}{
		{name: "none", want: []string{}},
		{name: "one", names: []string{"source"}, want: []string{"source"}},
		{name: "two", names: []string{"target", "source"}, want: []string{"source", "target"}},
		{name: "two_unicode", names: []string{"目标", "alpha"}, want: []string{"alpha", "目标"}},
		{name: "additional", names: []string{"target", "zero", "source", "alpha"}, want: []string{"alpha", "source", "target", "zero"}},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			state := attributeOwnershipState(t, 1000)
			frame := state.newExecutionFrame("source", "target", "")
			for _, key := range scenario.names {
				frame.stageFor(key)
			}
			keyBuffer := [2]string{"untouched0", "untouched1"}
			keys, _, err := frame.prepareAndValidateCommit(keyBuffer[:0])
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(keys, scenario.want) {
				t.Fatal("commit keys lost lexical order or additional combatants", keys)
			}
			if len(keys) > 0 && len(keys) <= 2 && &keys[0] != &keyBuffer[0] {
				t.Fatal("small preflight did not use its caller's buffer")
			}
			if len(keys) > 2 && keyBuffer != [2]string{"untouched0", "untouched1"} {
				t.Fatal("additional combatants changed the caller's small buffer")
			}
			child := state.newExecutionFrame("source", "target", "child")
			child.stageFor("omega")
			child.stageFor("beta")
			var childBuffer [2]string
			childKeys, _, err := child.prepareAndValidateCommit(childBuffer[:0])
			if err != nil || !reflect.DeepEqual(childKeys, []string{"beta", "omega"}) || !reflect.DeepEqual(keys, scenario.want) {
				t.Fatal("child preflight changed the parent's commit keys", childKeys, keys, err)
			}
		})
	}
}

func TestFrameAllocationCommitKeysSmallPathDoesNotAllocate(t *testing.T) {
	for _, scenario := range []struct {
		name string
		keys []string
	}{
		{name: "none"},
		{name: "one", keys: []string{"source"}},
		{name: "two", keys: []string{"target", "source"}},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			staged := &frameStagedCollection{}
			for _, key := range scenario.keys {
				staged.Set(key, nil)
			}
			allocations := testing.AllocsPerRun(100, func() {
				var keyBuffer [2]string
				keys := sortedFrameCombatantKeys(staged, keyBuffer[:0])
				if len(keys) != staged.Len() || (len(keys) == 2 && keys[0] > keys[1]) {
					t.Fatal("small key collection lost length or lexical order")
				}
			})
			if allocations != 0 {
				t.Fatalf("small key collection allocated: %g", allocations)
			}
		})
	}
}

func TestFrameAllocationCallerOwnedInitializationResetsAndKeepsEarlierViews(t *testing.T) {
	state := attributeOwnershipState(t, 1000)
	var frame Frame
	state.initExecutionFrame(&frame, "source", "target", "first")
	if err := frame.applyCooldownChange("source", "control", 700); err != nil {
		t.Fatal(err)
	}
	firstStage := frame.stageFor("source")
	snapshot := frame.captureEmitSnapshot(attributeOwnershipEvent, "source", "target")
	wantSource := independentAttributeTable(snapshot.SourceAttrs)
	frame.commit()
	if frame.fatal || !frame.committed {
		t.Fatal(frame.fatalErr)
	}
	firstID := frame.frameID
	frame.fatal = true
	frame.fatalErr = &model.EngineError{Code: model.GenericErrRuntimeInvariantFailed}
	frame.strictReads, frame.skipBlockedWrites, frame.processCostReadable = true, true, true
	frame.ownerCombatantKey, frame.ownerProviderRef, frame.processUseKey = "source", "stale", "stale"
	frame.commandCount, frame.chainDepth = 3, 2
	frame.eventCtx = &snapshot
	frame.actionFrame.StageAttackWait(actionpkg.NewAttackWait(actionpkg.AttackWaitSeed{Anchor: 900}))
	frame.pendingEvents = []emittedEvent{{eventType: "stale"}}
	frame.processActualCosts = model.BorrowNumericView(map[string]float64{"mana": 10})
	state.initExecutionFrame(&frame, "target", "target", "second")
	if frame.frameID != firstID+1 || frame.sourceKey != "target" || frame.targetKey != "target" || frame.abilityRef != "second" || frame.run != state {
		t.Fatal("caller-owned reinitialization lost its new identity")
	}
	if frame.fatal || frame.fatalErr != nil || frame.committed || frame.strictReads || frame.skipBlockedWrites || frame.processCostReadable || frame.eventCtx != nil || frame.actionFrame.AttackWait() != nil || len(frame.pendingEvents) != 0 || frame.processActualCosts.Present() || frame.ownerCombatantKey != "" || frame.ownerProviderRef != "" || frame.processUseKey != "" || frame.commandCount != 0 || frame.chainDepth != 0 || frame.staged.Len() != 0 {
		t.Fatal("caller-owned reinitialization retained prior execution state")
	}
	if !reflect.DeepEqual(frame.entrySourceAttrs, state.combatants["target"].attributesView()) || !reflect.DeepEqual(frame.entryTargetAttrs, state.combatants["target"].attributesView()) {
		t.Fatal("caller-owned reinitialization retained earlier entry snapshots")
	}
	if err := frame.applyCooldownChange("target", "second", 900); err != nil {
		t.Fatal(err)
	}
	frame.fatal = true
	frame.commit()
	if _, exists := state.combatants["target"].cooldowns.Entry(actionpkg.AbilityCooldownIdentity("target", "second")); exists {
		t.Fatal("failed reinitialized frame published its cooldown")
	}
	if firstStage.cooldowns.AbilityReadyAt("source", "control") != 700 || state.combatants["source"].cooldowns.AbilityReadyAt("source", "control") != 700 || !reflect.DeepEqual(snapshot.SourceAttrs, wantSource) {
		t.Fatal("reinitialized local storage changed an earlier staged or event view")
	}
}

func TestFrameAllocationCallerOwnedProcessKeepsIndependentPendingCopies(t *testing.T) {
	state := waitingTestState(t)
	if state.actions.ProcessCount() == 0 {
		t.Fatal("missing committed process")
	}
	process := state.actions.ProcessAt(0)
	originalCosts := maps.Clone(process.ActualCosts())
	var frame Frame
	state.initProcessFrame(&frame, process)
	if frame.activeProcessOriginal != process || frame.activeProcess == process || !frame.strictReads || frame.ownerCombatantKey != process.Owner() || frame.ownerProviderRef != process.ProviderRef() {
		t.Fatal("caller-owned process initialization lost ownership or pending isolation")
	}
	firstID := frame.frameID
	firstPending := frame.activeProcess
	frame.activeProcessChanges.SetActualCost("audit", 10)
	frame.activeProcessChanges.EnterStep(firstPending.StepIndex(), planbundle.CompiledProcessStep{StepKey: "pending-only"}, state.loop.TimeMs())
	if !reflect.DeepEqual(process.ActualCosts(), originalCosts) || process.StepKey() == "pending-only" {
		t.Fatal("pending process changes leaked before commit")
	}
	frame.fatal, frame.committed = true, true
	state.initProcessFrame(&frame, process)
	if frame.frameID != firstID+1 || frame.fatal || frame.committed || frame.activeProcess == firstPending || frame.activeProcess == process || frame.activeProcessOriginal != process {
		t.Fatal("reinitialized process frame retained an earlier pending process")
	}
	if !reflect.DeepEqual(frame.activeProcess.ActualCosts(), originalCosts) || firstPending.ActualCosts()["audit"] != 10 || firstPending.StepKey() != "pending-only" {
		t.Fatal("new process initialization changed an earlier independent pending copy")
	}
}

func TestFrameAllocationCallerOwnedConstructorLeavesOnlyStagingAllocation(t *testing.T) {
	state := attributeOwnershipState(t, 1000)
	allocations := testing.AllocsPerRun(100, func() {
		var frame Frame
		state.initExecutionFrame(&frame, "source", "target", "")
		if frame.frameID == 0 {
			t.Fatal("caller-owned frame did not acquire its identity")
		}
	})
	if allocations > 1 {
		t.Fatalf("caller-owned constructor allocated beyond its staging map: %g", allocations)
	}
	t.Logf("executionFrameBytes=%d constructorAllocations=%g", reflect.TypeOf(Frame{}).Size(), allocations)
}
