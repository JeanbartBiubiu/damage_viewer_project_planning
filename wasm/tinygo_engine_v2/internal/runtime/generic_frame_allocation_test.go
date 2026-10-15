package runtime

import (
	"maps"
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

// 测试需要同时持有多个帧，生产入口直接初始化调用方局部对象。
func (s *genericRunState) newExecutionFrame(sourceKey, targetKey, abilityRef string) *executionFrame {
	frame := &executionFrame{}
	s.initExecutionFrame(frame, sourceKey, targetKey, abilityRef)
	return frame
}

func testCooldownEntries(ledger *genericCooldownLedger) map[genericCooldownIdentity]genericCooldownEntry {
	if ledger == nil {
		return nil
	}
	return maps.Clone(ledger.entries)
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
				live.cooldowns = genericCooldownLedgerFromDeadlines("source", initial.values)
			}
			initialEntries := testCooldownEntries(live.cooldowns)
			state.combatants["source"] = live
			frame := state.newExecutionFrame("source", "target", "")
			frozen := frame.stageFor("source").readonlyCooldowns()
			before := testCooldownEntries(frozen)
			if err := frame.applyCooldownChange("source", "inserted", 0); err != nil {
				t.Fatal(err)
			}
			if value, exists := frame.stageFor("source").cooldowns.entries[genericAbilityCooldownIdentity("source", "inserted")]; !exists || value.readyAt != 0 {
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
			if value, exists := published.entries[genericAbilityCooldownIdentity("source", "inserted")]; !exists || value.readyAt != 0 {
				t.Fatal("commit dropped the explicit zero cooldown")
			}
			if _, existed := initial.values["existing"]; existed {
				if value, exists := published.entries[genericAbilityCooldownIdentity("source", "existing")]; !exists || value.readyAt != 0 {
					t.Fatal("commit dropped the original zero cooldown")
				}
			}
			if err := frame.applyCooldownChange("source", "inserted", 500); err != nil {
				t.Fatal(err)
			}
			if published.abilityReadyAt("source", "inserted") != 0 || !reflect.DeepEqual(testCooldownEntries(frozen), before) {
				t.Fatal("post-commit frame write changed a published cooldown view")
			}
		})
	}
	// 未借出过只读视图的空暂存对象也必须允许首次写入。
	var staged stagedCombatant
	staged.writableCooldowns().set(genericAbilityCooldownIdentity("", "first"), 0, 0)
	if value, exists := staged.cooldowns.entries[genericAbilityCooldownIdentity("", "first")]; !exists || value.readyAt != 0 {
		t.Fatal("first write to an unshared nil cooldown table failed")
	}
}

func TestFrameAllocationCooldownChildCommitAndFailedParentKeepViews(t *testing.T) {
	state := attributeOwnershipState(t, 1000)
	live := state.combatants["source"]
	live.cooldowns = genericCooldownLedgerFromDeadlines("source", map[string]int64{"control": 1000, "zero": 0})
	state.combatants["source"] = live
	parent := state.newExecutionFrame("source", "target", "parent")
	parentView := parent.stageFor("source").readonlyCooldowns()
	parentEntries := testCooldownEntries(parentView)
	child := state.newExecutionFrame("target", "source", "child")
	if err := child.applyCooldownChange("source", "control", 700); err != nil {
		t.Fatal(err)
	}
	child.commit()
	if child.fatal || !child.committed || state.combatants["source"].cooldowns.abilityReadyAt("source", "control") != 700 || parentView.abilityReadyAt("source", "control") != 1000 {
		t.Fatal("child commit changed the older parent view", child.fatalErr)
	}
	published := state.combatants["source"].cooldowns
	publishedEntries := testCooldownEntries(published)
	if err := parent.applyCooldownChange("source", "control", 800); err != nil {
		t.Fatal(err)
	}
	if published.abilityReadyAt("source", "control") != 700 || parentView.abilityReadyAt("source", "control") != 1000 {
		t.Fatal("parent write changed a committed child or older readonly view")
	}
	state.heap = scheduler.NewGenericHeap(1)
	state.heap.SetLimit(1)
	if state.heap.Push(scheduler.GenericEvent{TimeMs: 1000}) != model.ErrOK {
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
	if published.abilityReadyAt("source", "control") != 700 || state.combatants["source"].cooldowns.abilityReadyAt("source", "control") != 700 {
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
			var context executionFrame
			context.fatal, context.committed, context.skipBlockedWrites = true, true, true
			context.eventCtx = &eventFormulaSnapshot{eventType: "stale"}
			context.processActualCosts = map[string]float64{"mana": 10}
			context.processCostReadable = true
			context.pendingBasicAttackWait = state.basicAttack.wait
			if err := frame.basicAttackWaitContext(&context); err != nil {
				t.Fatal(err)
			}
			if context.sourceKey != "source" || context.targetKey != "target" || context.ownerCombatantKey != "source" || context.ownerProviderRef != "attack" || context.abilityRef != state.basicAttack.plan.InitialControlAbilityRef || !context.strictReads {
				t.Fatal("waiting context inherited an unrelated frame direction or owner")
			}
			if context.fatal || context.committed || context.skipBlockedWrites || context.eventCtx != nil || context.processActualCosts != nil || context.processCostReadable || context.pendingBasicAttackWait != nil {
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
			if _, exists := frame.staged.Get("target").cooldowns.entries[genericAbilityCooldownIdentity("target", "zero")]; !exists {
				t.Fatal("waiting context lost the ordinary shared staging write")
			}
			if _, exists := state.combatants["target"].cooldowns.entries[genericAbilityCooldownIdentity("target", "zero")]; exists {
				t.Fatal("waiting context published before parent commit")
			}
		})
	}
}

func frameAllocationWaitingProviderState(t *testing.T) *genericRunState {
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
	if _, exists := state.heap.Pop(); !exists {
		t.Fatal("missing first attack")
	}
	if err := state.handleBasicAttack(); err != nil {
		t.Fatal(err)
	}
	state.nowMs = 400
	return state
}

func TestFrameAllocationWaitProviderPreviewAndCooldownWritesStayIndependent(t *testing.T) {
	state := frameAllocationWaitingProviderState(t)
	control := state.basicAttack.plan.InitialControlAbilityRef
	frame := state.newExecutionFrame("target", "source", "speed-change")
	source := frame.stageFor("source")
	if err := frame.applyCooldownChange("source", "auxiliary", 0); err != nil {
		t.Fatal(err)
	}
	source.providerOps = []stagedProviderMutation{{kind: "apply", definitionRef: "waiting-speed", sourceKey: "source", targetKey: "source"}}
	parentVersion := source.cooldowns
	var preview executionFrame
	if err := frame.basicAttackWaitContext(&preview); err != nil {
		t.Fatal(err)
	}
	previewSource := preview.stageFor("source")
	if previewSource == source || previewSource.attributes.At("attack_speed").Resolved != 2 || source.attributes.At("attack_speed").Resolved != 1 || state.combatants["source"].attributes.At("attack_speed").Resolved != 1 {
		t.Fatal("provider preview did not isolate the changed speed")
	}
	if err := preview.applyCooldownChange("source", "auxiliary", 50); err != nil {
		t.Fatal(err)
	}
	if source.cooldowns.abilityReadyAt("source", "auxiliary") != 0 || parentVersion.abilityReadyAt("source", "auxiliary") != 0 {
		t.Fatal("preview cooldown write changed the parent's view")
	}
	if err := frame.applyCooldownChange("source", "auxiliary", 60); err != nil {
		t.Fatal(err)
	}
	if previewSource.cooldowns.abilityReadyAt("source", "auxiliary") != 50 || parentVersion.abilityReadyAt("source", "auxiliary") != 0 {
		t.Fatal("parent cooldown write changed a preview or prior view")
	}
	if _, err := frame.prepareBasicAttackWait(); err != nil {
		t.Fatal(err)
	}
	wait := frame.pendingBasicAttackWait
	if wait == nil || basicAttackProgressDeadline(wait) != 700 || wait.sourceAttributes.At("attack_speed").Resolved != 2 || source.cooldowns.abilityReadyAt("source", control) != 700 || state.basicAttackReadyAt() != 1000 || state.combatants["source"].cooldowns.abilityReadyAt("source", control) != 1000 {
		t.Fatal("waiting preflight did not stage the provider-adjusted cooldown", wait)
	}
	if parentVersion.abilityReadyAt("source", control) != 1000 || previewSource.cooldowns.abilityReadyAt("source", control) != 1000 {
		t.Fatal("waiting preflight changed a prior readonly cooldown view")
	}
	frame.commit()
	if frame.fatal || !frame.committed || state.basicAttackReadyAt() != 700 || state.combatants["source"].cooldowns.abilityReadyAt("source", control) != 700 || state.combatants["source"].attributes.At("attack_speed").Resolved != 2 {
		t.Fatal("provider and adjusted waiting clock did not commit together", frame.fatalErr)
	}
	providerRef := ""
	for _, provider := range state.combatants["source"].providers {
		if provider.DefinitionRef == "waiting-speed" {
			providerRef = provider.ProviderRef
		}
	}
	if providerRef == "" {
		t.Fatal("committed waiting provider is missing")
	}
	state.nowMs = 500
	remove := state.newExecutionFrame("source", "source", "speed-expire")
	remove.stageFor("source").providerOps = []stagedProviderMutation{{kind: "expire", providerRef: providerRef, targetKey: "source"}}
	if _, err := remove.prepareBasicAttackWait(); err != nil {
		t.Fatal(err)
	}
	if remove.pendingBasicAttackWait == nil || basicAttackProgressDeadline(remove.pendingBasicAttackWait) != 900 || remove.stageFor("source").attributes.At("attack_speed").Resolved != 2 || state.basicAttackReadyAt() != 700 || wait.sourceAttributes.At("attack_speed").Resolved != 2 {
		t.Fatal("provider removal preview changed an older frame or waiting snapshot")
	}
	remove.commit()
	if remove.fatal || state.basicAttackReadyAt() != 900 || state.combatants["source"].attributes.At("attack_speed").Resolved != 1 || basicAttackProgressDeadline(wait) != 700 || wait.sourceAttributes.At("attack_speed").Resolved != 2 {
		t.Fatal("provider removal changed an earlier waiting snapshot", remove.fatalErr)
	}
}

func TestFrameAllocationFailedWaitProviderPreviewDoesNotPublish(t *testing.T) {
	state := waitingTestState(t)
	frame := state.newExecutionFrame("source", "target", "bad-provider")
	control := state.basicAttack.plan.InitialControlAbilityRef
	before := testCooldownEntries(state.combatants["source"].cooldowns)
	wait := state.basicAttack.wait
	if err := frame.applyCooldownChange("source", control, 800); err != nil {
		t.Fatal(err)
	}
	frame.stageFor("source").providerOps = []stagedProviderMutation{{kind: "apply", definitionRef: "missing", sourceKey: "source", targetKey: "source"}}
	frame.commit()
	if !frame.fatal || frame.fatalErr == nil || frame.committed || state.basicAttack.wait != wait || !reflect.DeepEqual(testCooldownEntries(state.combatants["source"].cooldowns), before) {
		t.Fatal("failed provider preview published cooldown or waiting changes", frame.fatalErr)
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
			keys, err := frame.commitKeysAndPreflight(keyBuffer[:0])
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
			childKeys, err := child.commitKeysAndPreflight(childBuffer[:0])
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
	var frame executionFrame
	state.initExecutionFrame(&frame, "source", "target", "first")
	if err := frame.applyCooldownChange("source", "control", 700); err != nil {
		t.Fatal(err)
	}
	firstStage := frame.stageFor("source")
	snapshot := frame.captureEmitSnapshot(attributeOwnershipEvent, "source", "target")
	wantSource := independentAttributeTable(snapshot.sourceAttrs)
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
	frame.pendingBasicAttackWait = &basicAttackWait{anchor: 900}
	frame.pendingEvents = []emittedEvent{{eventType: "stale"}}
	frame.processActualCosts = map[string]float64{"mana": 10}
	state.initExecutionFrame(&frame, "target", "target", "second")
	if frame.frameID != firstID+1 || frame.sourceKey != "target" || frame.targetKey != "target" || frame.abilityRef != "second" || frame.run != state {
		t.Fatal("caller-owned reinitialization lost its new identity")
	}
	if frame.fatal || frame.fatalErr != nil || frame.committed || frame.strictReads || frame.skipBlockedWrites || frame.processCostReadable || frame.eventCtx != nil || frame.pendingBasicAttackWait != nil || len(frame.pendingEvents) != 0 || frame.processActualCosts != nil || frame.ownerCombatantKey != "" || frame.ownerProviderRef != "" || frame.processUseKey != "" || frame.commandCount != 0 || frame.chainDepth != 0 || frame.staged.Len() != 0 {
		t.Fatal("caller-owned reinitialization retained prior execution state")
	}
	if !reflect.DeepEqual(frame.entrySourceAttrs, state.combatants["target"].attributes) || !reflect.DeepEqual(frame.entryTargetAttrs, state.combatants["target"].attributes) {
		t.Fatal("caller-owned reinitialization retained earlier entry snapshots")
	}
	if err := frame.applyCooldownChange("target", "second", 900); err != nil {
		t.Fatal(err)
	}
	frame.fatal = true
	frame.commit()
	if _, exists := state.combatants["target"].cooldowns.entries[genericAbilityCooldownIdentity("target", "second")]; exists {
		t.Fatal("failed reinitialized frame published its cooldown")
	}
	if firstStage.cooldowns.abilityReadyAt("source", "control") != 700 || state.combatants["source"].cooldowns.abilityReadyAt("source", "control") != 700 || !reflect.DeepEqual(snapshot.sourceAttrs, wantSource) {
		t.Fatal("reinitialized local storage changed an earlier staged or event view")
	}
}

func TestFrameAllocationCallerOwnedProcessKeepsIndependentPendingCopies(t *testing.T) {
	state := waitingTestState(t)
	if len(state.processInstances) == 0 {
		t.Fatal("missing committed process")
	}
	process := state.processInstances[0]
	originalCosts := maps.Clone(process.ActualCosts)
	var frame executionFrame
	state.initProcessFrame(&frame, process)
	if frame.processOriginal != process || frame.pendingProcess == process || !frame.strictReads || frame.ownerCombatantKey != process.Owner || frame.ownerProviderRef != process.ProviderRef {
		t.Fatal("caller-owned process initialization lost ownership or pending isolation")
	}
	firstID := frame.frameID
	firstPending := frame.pendingProcess
	firstPending.ActualCosts["audit"] = 10
	firstPending.StepKey = "pending-only"
	if !reflect.DeepEqual(process.ActualCosts, originalCosts) || process.StepKey == "pending-only" {
		t.Fatal("pending process changes leaked before commit")
	}
	frame.fatal, frame.committed = true, true
	state.initProcessFrame(&frame, process)
	if frame.frameID != firstID+1 || frame.fatal || frame.committed || frame.pendingProcess == firstPending || frame.pendingProcess == process || frame.processOriginal != process {
		t.Fatal("reinitialized process frame retained an earlier pending process")
	}
	if !reflect.DeepEqual(frame.pendingProcess.ActualCosts, originalCosts) || firstPending.ActualCosts["audit"] != 10 || firstPending.StepKey != "pending-only" {
		t.Fatal("new process initialization changed an earlier independent pending copy")
	}
}

func TestFrameAllocationCallerOwnedConstructorLeavesOnlyStagingAllocation(t *testing.T) {
	state := attributeOwnershipState(t, 1000)
	allocations := testing.AllocsPerRun(100, func() {
		var frame executionFrame
		state.initExecutionFrame(&frame, "source", "target", "")
		if frame.frameID == 0 {
			t.Fatal("caller-owned frame did not acquire its identity")
		}
	})
	if allocations > 1 {
		t.Fatalf("caller-owned constructor allocated beyond its staging map: %g", allocations)
	}
	t.Logf("executionFrameBytes=%d constructorAllocations=%g", reflect.TypeOf(executionFrame{}).Size(), allocations)
}
