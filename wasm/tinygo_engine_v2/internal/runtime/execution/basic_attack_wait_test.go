package execution

import (
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	scheduler "tinygo_engine_v2/internal/scheduler"
)

func waitingTestState(t *testing.T) *Engine {
	t.Helper()
	return waitingTestStateWithDuration(t, 4000)
}

func waitingTestStateWithDuration(t *testing.T, duration int64) *Engine {
	t.Helper()
	input, request := continuousAttackInput(1, 10000, 0, 0, 0, duration)
	request.DriverPlan.BasicAttack.AttackSpeedInputMax = 10
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
	return state
}

func changeWaitingSpeed(t *testing.T, state *Engine, at int64, speed float64) *Frame {
	t.Helper()
	state.loop.Advance(at)
	frame := state.newExecutionFrame("source", "target", "test-speed")
	staged := frame.stageFor("source")
	slot := staged.attributesView().At("attack_speed")
	slot.Base, slot.Resolved = speed, speed

	staged.setAttributes(staged.attributesView().With("attack_speed", slot))
	frame.commit()
	return frame
}

func TestContinuousWaitingPreservesFractionAndUniqueEvent(t *testing.T) {
	for _, scenario := range []struct {
		speed float64
		ready int64
	}{{2, 700}, {.5, 1600}} {
		state := waitingTestState(t)
		frame := changeWaitingSpeed(t, state, 400, scenario.speed)
		if frame.fatal || state.basicAttackReadyAt() != scenario.ready || state.loop.QueuedEvents() != 1 || state.actions.BasicAttack().Wait().Remaining() != .6 || state.combatants["source"].cooldowns.AbilityReadyAt("source", state.actions.BasicAttack().Plan().InitialControlAbilityRef) != scenario.ready {
			t.Fatal(scenario, frame.fatalErr, state.actions.BasicAttack().Wait(), state.loop.QueuedEvents())
		}
		attack := state.report.Snapshot().AttackRecords[0]
		if *attack.ReadyAtMs != 1000 || *attack.FinalReadyAtMs != scenario.ready || *attack.NextStartAtMs != scenario.ready || attack.AttackSpeed != 1 {
			t.Fatal(attack)
		}
		if state.basicAttackEventCurrent(scheduler.GenericEvent{TimeMs: 1000, BasicAttackGeneration: 1}) {
			t.Fatal("old attack node remained effective")
		}
		if err := state.runLoop(); err != nil {
			t.Fatal(err)
		}
		if state.report.Snapshot().AttackRecords[1].StartAtMs != scenario.ready {
			t.Fatal(state.report.Snapshot().AttackRecords)
		}
	}
}

func TestContinuousWaitingBudgetFailureDoesNotPublishSpeedOrClock(t *testing.T) {
	state := waitingTestState(t)
	state.budget.MaxCommandsPerEvent = 0
	frame := changeWaitingSpeed(t, state, 400, 2)
	if !frame.fatal || frame.fatalErr.BudgetCause != model.BudgetCauseMaxCommandsPerEvent || state.combatants["source"].attributesView().At("attack_speed").Resolved != 1 || state.basicAttackReadyAt() != 1000 || state.loop.QueuedEvents() != 1 {
		t.Fatal(frame.fatalErr, state.actions.BasicAttack().Wait())
	}
}

func TestContinuousWaitingBeyondWindowCanReturnIntoWindow(t *testing.T) {
	state := waitingTestStateWithDuration(t, 900)
	state.publishBasicAttackWait()
	if state.actions.BasicAttack().Current().NextStartAtMs() != nil {
		t.Fatal(state.actions.BasicAttack().Current())
	}
	frame := changeWaitingSpeed(t, state, 400, 2)
	if frame.fatal || state.actions.BasicAttack().WindowSettled() || state.actions.BasicAttack().Current().NextStartAtMs() == nil || *state.actions.BasicAttack().Current().NextStartAtMs() != 700 {
		t.Fatal(frame.fatalErr, state.actions.BasicAttack().Current())
	}
}

func TestSourceStateExpiryRejectsStaleExpiry(t *testing.T) {
	state := waitingTestState(t)
	actor := state.combatants["source"]
	setTestProviderStateBag(&actor.providerState, "test-stack", providerStateTestSeed{state: map[string]float64{"stack": 1}, expireAt: map[string]int64{"stack": 400}, fieldDefs: map[string]effectpkg.FieldDefinition{"stack": {DefaultValue: 0}}})
	state.combatants["source"] = actor
	state.loop.Advance(400)
	state.applyProviderSourceStateExpiry(effectpkg.ExpiryPayload{Kind: "provider_source_state", CombatantKey: "source", ProviderRef: "test-stack", StateKey: "stack", ExpectedExpireAt: 300})
	if state.combatants["source"].providerState.Lookup("test-stack").State().At("stack") != 1 {
		t.Fatal("stale expiry cleared current state")
	}
	state.applyProviderSourceStateExpiry(effectpkg.ExpiryPayload{Kind: "provider_source_state", CombatantKey: "source", ProviderRef: "test-stack", StateKey: "stack", ExpectedExpireAt: 400})
	if state.processFailure != nil || state.combatants["source"].providerState.Lookup("test-stack").State().At("stack") != 0 {
		t.Fatal(state.processFailure)
	}
}
