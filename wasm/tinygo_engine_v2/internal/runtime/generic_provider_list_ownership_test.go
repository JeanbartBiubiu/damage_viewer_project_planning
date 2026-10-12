package runtime

import (
	"bytes"
	"testing"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
	"tinygo_engine_v2/internal/status"
)

func providerListOwnershipState(t *testing.T) *genericRunState {
	t.Helper()
	input, request := frameCommitInput()
	input.SharedProviders = append(input.SharedProviders,
		slowProvider("ownership:slow", "slow_result", "slow_value", .3, 1000),
		model.ProviderDefinition{ProviderKey: "ownership:stack", Kind: "status", StableID: "ownership_stack", Lifecycle: &model.ProviderLifecycle{DurationMs: statusDuration(1000), MaxStacks: 3, RefreshPolicy: "add_stack"}},
	)
	return frameCommitState(t, input, request)
}

func providerListOwnershipSlow(strength float64) []status.StatusContribution {
	return []status.StatusContribution{{ResultRef: "slow_result", StatusKey: "slow_value", StatusKind: model.StatusKindMovementSlow, Strength: strength}}
}

func assertProviderListSnapshot(t *testing.T, providers []status.ProviderInstance, before []byte) {
	t.Helper()
	if !bytes.Equal(before, mustJSON(providersToSnapshot(providers))) {
		t.Fatalf("a live write changed an older provider list: %+v", providersToSnapshot(providers))
	}
}

func TestProviderListOwnershipAppendProtectsSharedCapacity(t *testing.T) {
	storage := make([]status.ProviderInstance, 1, 4)
	storage[0] = status.ProviderInstance{ProviderRef: "existing", Stacks: 1}
	combatant := combatantRuntime{providers: storage, providersShared: true}
	combatant.providers = append(combatant.writableProviders(), status.ProviderInstance{ProviderRef: "added", Stacks: 1})
	if combatant.providersShared || len(combatant.providers) != 2 || &combatant.providers[0] == &storage[0] || storage[:cap(storage)][1].ProviderRef != "" {
		t.Fatal("append wrote into the capacity of a shared provider list")
	}
	current := &combatant.providers[0]
	combatant.writableProviders()[0].Stacks = 2
	if &combatant.providers[0] != current {
		t.Fatal("an already owned list was copied again")
	}
}

func TestProviderListOwnershipLiveAppendRefreshAndResharing(t *testing.T) {
	state := providerListOwnershipState(t)
	if err := state.applyProviderInstance("target", "source", "ownership:stack", 1000, true, nil); err != nil {
		t.Fatal(err)
	}
	frame := state.newExecutionFrame("source", "target", "ownership")
	staged := frame.stageFor("target")
	before := mustJSON(providersToSnapshot(staged.providers))
	if !state.combatants["target"].providersShared || &staged.providers[0] != &state.combatants["target"].providers[0] {
		t.Fatal("stageFor failed to share and mark the live provider list")
	}
	if err := state.applyProviderInstance("target", "source", "ownership:stack", 1500, true, nil); err != nil {
		t.Fatal(err)
	}
	assertProviderListSnapshot(t, staged.providers, before)
	if state.combatants["target"].providersShared || len(state.combatants["target"].providers) != 2 {
		t.Fatal("live append did not obtain an owned list")
	}
	second := state.newExecutionFrame("source", "target", "second").stageFor("target")
	secondBefore := mustJSON(providersToSnapshot(second.providers))
	if !state.combatants["target"].providersShared {
		t.Fatal("a written list was not shared again by a new frame")
	}
	if err := state.refreshProviderInstance("target", second.providers[0].ProviderRef, 2000, true, nil); err != nil {
		t.Fatal(err)
	}
	assertProviderListSnapshot(t, staged.providers, before)
	assertProviderListSnapshot(t, second.providers, secondBefore)
	if state.combatants["target"].providers[0].Stacks != 2 || state.combatants["target"].providersShared {
		t.Fatal("refresh lost stack semantics or left the written list shared")
	}
}

func TestProviderListOwnershipReplacePreservesNestedReadOnlyData(t *testing.T) {
	state := providerListOwnershipState(t)
	if err := state.applyProviderInstance("target", "source", "ownership:slow", 1000, true, providerListOwnershipSlow(.3)); err != nil {
		t.Fatal(err)
	}
	combatant := state.combatants["target"]
	combatant.providers[0].State["historical_value"] = 7.0
	state.combatants["target"] = combatant
	staged := state.newExecutionFrame("source", "target", "replace").stageFor("target")
	before := mustJSON(providersToSnapshot(staged.providers))
	contributions := providerListOwnershipSlow(.7)
	if err := state.applyProviderInstance("target", "source", "ownership:slow", 2000, true, contributions); err != nil {
		t.Fatal(err)
	}
	contributions[0].Strength = .99
	assertProviderListSnapshot(t, staged.providers, before)
	live := state.combatants["target"].providers
	if len(live) != 1 || live[0].ProviderRef != staged.providers[0].ProviderRef || live[0].ExpireAt != 2000 || live[0].StatusContributions[0].Strength != .7 || live[0].State["historical_value"] != 7.0 {
		t.Fatalf("source-target replace or nested data changed: %+v", live)
	}
}

func TestProviderListOwnershipRemovalAndSweepKeepOldFrames(t *testing.T) {
	state := providerListOwnershipState(t)
	for _, expireAt := range []int64{1000, 2000, 3000} {
		if err := state.applyProviderInstance("target", "source", "ownership:stack", expireAt, true, nil); err != nil {
			t.Fatal(err)
		}
	}
	staged := state.newExecutionFrame("source", "target", "remove").stageFor("target")
	before := mustJSON(providersToSnapshot(staged.providers))
	state.removeProviderInstance("target", staged.providers[0].ProviderRef, state.evalContextForCombatants("source", "target"), model.EvidenceKindProviderRemove)
	assertProviderListSnapshot(t, staged.providers, before)
	if live := state.combatants["target"].providers; len(live) != 2 || live[0].ProviderRef != staged.providers[1].ProviderRef {
		t.Fatal("provider removal changed stable order")
	}
	sweepView := state.newExecutionFrame("source", "target", "sweep").stageFor("target")
	sweepBefore := mustJSON(providersToSnapshot(sweepView.providers))
	state.nowMs = 2000
	state.sweepExpiredInstances()
	assertProviderListSnapshot(t, staged.providers, before)
	assertProviderListSnapshot(t, sweepView.providers, sweepBefore)
	if live := state.combatants["target"]; len(live.providers) != 1 || live.providers[0].ProviderRef != sweepView.providers[1].ProviderRef || live.providersShared {
		t.Fatal("sweep did not install its independent active list")
	}
}

func TestProviderListOwnershipStaleExpiryAndPostCommitWrites(t *testing.T) {
	state := providerListOwnershipState(t)
	if err := state.applyProviderInstance("target", "source", "ownership:slow", 1000, true, providerListOwnershipSlow(.3)); err != nil {
		t.Fatal(err)
	}
	oldCleanup := len(state.expireCleanupPayloads) - 1
	frame := state.newExecutionFrame("source", "target", "commit")
	staged := frame.stageFor("target")
	before := mustJSON(providersToSnapshot(staged.providers))
	frame.commit()
	if frame.fatal || !frame.committed || !state.combatants["target"].providersShared || &staged.providers[0] != &state.combatants["target"].providers[0] {
		t.Fatal("commit failed to publish a shared read-only list")
	}
	if err := state.refreshProviderInstance("target", staged.providers[0].ProviderRef, 2000, true, providerListOwnershipSlow(.5)); err != nil {
		t.Fatal(err)
	}
	assertProviderListSnapshot(t, staged.providers, before)
	state.nowMs = 1000
	state.handleExpireCleanup(scheduler.GenericEvent{DriverEntryIndex: oldCleanup})
	if live := state.combatants["target"].providers; len(live) != 1 || live[0].ExpireAt != 2000 {
		t.Fatal("stale expiry removed a refreshed provider")
	}
	assertProviderListSnapshot(t, staged.providers, before)
	failed := state.newExecutionFrame("source", "target", "failed")
	host := failed.stageFor("target")
	failedBefore := mustJSON(providersToSnapshot(host.providers))
	host.providerOps = append(host.providerOps, stagedProviderMutation{kind: "expire", targetKey: "target", providerRef: host.providers[0].ProviderRef})
	failed.fatal, failed.fatalErr = true, state.budgetError(model.BudgetCauseMaxCommandsPerEvent, "failed ownership frame")
	failed.commit()
	assertProviderListSnapshot(t, host.providers, failedBefore)
	assertProviderListSnapshot(t, state.combatants["target"].providers, failedBefore)
}

func TestProviderListOwnershipDynamicListenerRemovalKeepsFrozenList(t *testing.T) {
	input, request := withSkillHit(t, []model.SkillHitCandidate{damageCand("dmg", "occ", "rd", model.SpellShieldScopeResult, 0)},
		[]model.ProviderDefinition{spellShieldProvider()}, nil,
		[]model.DriverEntry{hitEntry("h1", 0, 0)},
		[]model.SkillUseFact{{UseKey: "u1", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}},
		[]model.SkillHitFact{{DriverEntryKey: "h1", UseRef: hitUse("u1")}}, 50)
	expireAt := int64(5000)
	request.InitialSnapshot.Combatants[1].Providers = []model.CombatantProviderSnapshot{{ProviderRef: "shield:spell#restored", DefinitionRef: "shield:spell", Source: "source", Owner: "target", Stacks: 1, ExpireAt: &expireAt}}
	compiled := compilebundle.CompileGeneric(input)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	expected, err := RunGeneric(compiled.Session, request)
	if err != nil {
		t.Fatal(err)
	}
	state, err := newGenericRunState(compiled.Session, request)
	if err != nil {
		t.Fatal(err)
	}
	view := state.newExecutionFrame("source", "target", "before_hit").stageFor("target")
	before := mustJSON(providersToSnapshot(view.providers))
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	got := state.buildDoneResult()
	if !bytes.Equal(mustJSON(expected), mustJSON(got)) || len(state.runtimeListeners) != 0 {
		t.Fatal("provider-list sharing changed the real blocked-hit/listener result")
	}
	assertProviderListSnapshot(t, view.providers, before)
}
