package execution

import effectpkg "tinygo_engine_v2/internal/runtime/effect"

import (
	"bytes"
	"testing"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

func providerListOwnershipState(t *testing.T) *Engine {
	t.Helper()
	input, request := frameCommitInput()
	input.SharedProviders = append(input.SharedProviders,
		slowProvider("ownership:slow", "slow_result", "slow_value", .3, 1000),
		model.ProviderDefinition{ProviderKey: "ownership:stack", Kind: "status", StableID: "ownership_stack", Lifecycle: &model.ProviderLifecycle{DurationMs: statusDuration(1000), MaxStacks: 3, RefreshPolicy: "add_stack"}},
	)
	return frameCommitState(t, input, request)
}

func providerListOwnershipSlow(strength float64) effectpkg.ContributionView {
	return effectpkg.StatusContributions([]effectpkg.StatusContribution{{ResultRef: "slow_result", StatusKey: "slow_value", StatusKind: model.StatusKindMovementSlow, Strength: strength}})
}

func assertProviderListSnapshot(t *testing.T, providers effectpkg.ProviderList, before []byte) {
	t.Helper()
	if !bytes.Equal(before, mustJSON(providersToSnapshot(providers))) {
		t.Fatalf("a live write changed an older provider list: %+v", providersToSnapshot(providers))
	}
}

func TestProviderListOwnershipLiveAppendRefreshAndResharing(t *testing.T) {
	state := providerListOwnershipState(t)
	if err := state.applyProviderInstance("target", "source", "ownership:stack", 1000, true, effectpkg.ContributionView{}); err != nil {
		t.Fatal(err)
	}
	frame := state.newExecutionFrame("source", "target", "ownership")
	staged := frame.stageFor("target")
	before := mustJSON(providersToSnapshot(staged.instances.Providers()))
	if staged.instances.Providers().Len() != state.combatants["target"].instances.Providers().Len() {
		t.Fatal("stageFor failed to share and mark the live provider list")
	}
	if err := state.applyProviderInstance("target", "source", "ownership:stack", 1500, true, effectpkg.ContributionView{}); err != nil {
		t.Fatal(err)
	}
	assertProviderListSnapshot(t, staged.instances.Providers(), before)
	if state.combatants["target"].instances.Providers().Len() != 2 {
		t.Fatal("live append did not obtain an owned list")
	}
	second := state.newExecutionFrame("source", "target", "second").stageFor("target")
	secondBefore := mustJSON(providersToSnapshot(second.instances.Providers()))
	if err := state.refreshProviderInstance("target", second.instances.Providers().At(0).ProviderRef, 2000, true, effectpkg.ContributionView{}); err != nil {
		t.Fatal(err)
	}
	assertProviderListSnapshot(t, staged.instances.Providers(), before)
	assertProviderListSnapshot(t, second.instances.Providers(), secondBefore)
	if state.combatants["target"].instances.Providers().At(0).Stacks != 2 {
		t.Fatal("refresh lost stack semantics or left the written list shared")
	}
}

func TestProviderListOwnershipReplacePreservesNestedReadOnlyData(t *testing.T) {
	state := providerListOwnershipState(t)
	if err := state.applyProviderInstance("target", "source", "ownership:slow", 1000, true, providerListOwnershipSlow(.3)); err != nil {
		t.Fatal(err)
	}
	combatant := state.combatants["target"]
	historical := combatant.instances.Providers().At(0)
	historical.State = effectpkg.ObjectState(map[string]interface{}{"historical_value": 7.0})
	combatant.instances.ReplaceProvider(0, historical)
	state.combatants["target"] = combatant
	staged := state.newExecutionFrame("source", "target", "replace").stageFor("target")
	before := mustJSON(providersToSnapshot(staged.instances.Providers()))
	contributions := providerListOwnershipSlow(.7)
	if err := state.applyProviderInstance("target", "source", "ownership:slow", 2000, true, contributions); err != nil {
		t.Fatal(err)
	}
	contributions.Snapshot()[0].Strength = .99
	assertProviderListSnapshot(t, staged.instances.Providers(), before)
	live := state.combatants["target"].instances.Providers()
	if live.Len() != 1 || live.At(0).ProviderRef != staged.instances.Providers().At(0).ProviderRef || live.At(0).ExpireAt != 2000 || live.At(0).StatusContributions.At(0).Strength != .7 || live.At(0).State.ToMap()["historical_value"] != 7.0 {
		t.Fatalf("source-target replace or nested data changed: %+v", live)
	}
}

func TestProviderListOwnershipRemovalAndSweepKeepOldFrames(t *testing.T) {
	state := providerListOwnershipState(t)
	for _, expireAt := range []int64{1000, 2000, 3000} {
		if err := state.applyProviderInstance("target", "source", "ownership:stack", expireAt, true, effectpkg.ContributionView{}); err != nil {
			t.Fatal(err)
		}
	}
	staged := state.newExecutionFrame("source", "target", "remove").stageFor("target")
	before := mustJSON(providersToSnapshot(staged.instances.Providers()))
	state.removeProviderInstance("target", staged.instances.Providers().At(0).ProviderRef, state.evalContextForCombatants("source", "target"), model.EvidenceKindProviderRemove)
	assertProviderListSnapshot(t, staged.instances.Providers(), before)
	if live := state.combatants["target"].instances.Providers(); live.Len() != 2 || live.At(0).ProviderRef != staged.instances.Providers().At(1).ProviderRef {
		t.Fatal("provider removal changed stable order")
	}
	sweepView := state.newExecutionFrame("source", "target", "sweep").stageFor("target")
	sweepBefore := mustJSON(providersToSnapshot(sweepView.instances.Providers()))
	state.loop.Advance(2000)
	state.sweepExpiredInstances()
	assertProviderListSnapshot(t, staged.instances.Providers(), before)
	assertProviderListSnapshot(t, sweepView.instances.Providers(), sweepBefore)
	if live := state.combatants["target"]; live.instances.Providers().Len() != 1 || live.instances.Providers().At(0).ProviderRef != sweepView.instances.Providers().At(1).ProviderRef {
		t.Fatal("sweep did not install its independent active list")
	}
}

func TestProviderListOwnershipStaleExpiryAndPostCommitWrites(t *testing.T) {
	state := providerListOwnershipState(t)
	if err := state.applyProviderInstance("target", "source", "ownership:slow", 1000, true, providerListOwnershipSlow(.3)); err != nil {
		t.Fatal(err)
	}
	oldCleanup := state.effectTimers.ExpiryCount() - 1
	frame := state.newExecutionFrame("source", "target", "commit")
	staged := frame.stageFor("target")
	before := mustJSON(providersToSnapshot(staged.instances.Providers()))
	frame.commit()
	if frame.fatal || !frame.committed || staged.instances.Providers().Len() != state.combatants["target"].instances.Providers().Len() {
		t.Fatal("commit failed to publish a shared read-only list")
	}
	if err := state.refreshProviderInstance("target", staged.instances.Providers().At(0).ProviderRef, 2000, true, providerListOwnershipSlow(.5)); err != nil {
		t.Fatal(err)
	}
	assertProviderListSnapshot(t, staged.instances.Providers(), before)
	state.loop.Advance(1000)
	state.handleExpireCleanup(scheduler.GenericEvent{DriverEntryIndex: oldCleanup})
	if live := state.combatants["target"].instances.Providers(); live.Len() != 1 || live.At(0).ExpireAt != 2000 {
		t.Fatal("stale expiry removed a refreshed provider")
	}
	assertProviderListSnapshot(t, staged.instances.Providers(), before)
	failed := state.newExecutionFrame("source", "target", "failed")
	host := failed.stageFor("target")
	failedBefore := mustJSON(providersToSnapshot(host.instances.Providers()))
	host.providerOps = append(host.providerOps, stagedProviderMutation{kind: "expire", targetKey: "target", providerRef: host.instances.Providers().At(0).ProviderRef})
	failed.fatal, failed.fatalErr = true, state.budgetError(model.BudgetCauseMaxCommandsPerEvent, "failed ownership frame")
	failed.commit()
	assertProviderListSnapshot(t, host.instances.Providers(), failedBefore)
	assertProviderListSnapshot(t, state.combatants["target"].instances.Providers(), failedBefore)
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
	expected, err := runForTest(compiled.Session, request)
	if err != nil {
		t.Fatal(err)
	}
	state, err := newGenericRunState(compiled.Session, request)
	if err != nil {
		t.Fatal(err)
	}
	view := state.newExecutionFrame("source", "target", "before_hit").stageFor("target")
	before := mustJSON(providersToSnapshot(view.instances.Providers()))
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	got := state.buildDoneResult(false)
	if !bytes.Equal(mustJSON(expected), mustJSON(got)) || len(state.runtimeListeners) != 0 {
		t.Fatal("provider-list sharing changed the real blocked-hit/listener result")
	}
	assertProviderListSnapshot(t, view.instances.Providers(), before)
}
