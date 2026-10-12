package runtime

import (
	"testing"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

func waitingTestState(t *testing.T) *genericRunState {
	t.Helper()
	input, request := continuousAttackInput(1, 10000, 0, 0, 0, 4000)
	request.DriverPlan.BasicAttack.AttackSpeedInputMax = 10
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
	return state
}

func changeWaitingSpeed(t *testing.T, state *genericRunState, at int64, speed float64) *executionFrame {
	t.Helper()
	state.nowMs = at
	frame := state.newExecutionFrame("source", "target", "test-speed")
	staged := frame.stageFor("source")
	slot := staged.attributes.At("attack_speed")
	slot.Base, slot.Resolved = speed, speed
	staged.attributes = staged.attributes.With("attack_speed", slot)
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
		if frame.fatal || state.basicAttack.wait.ready != scenario.ready || state.heap.Len() != 1 || state.basicAttack.wait.remaining != .6 || state.combatants["source"].cooldowns[state.basicAttack.plan.InitialControlAbilityRef] != scenario.ready {
			t.Fatal(scenario, frame.fatalErr, state.basicAttack.wait, state.heap.Len())
		}
		attack := state.attackRecords[0]
		if *attack.ReadyAtMs != 1000 || *attack.FinalReadyAtMs != scenario.ready || *attack.NextStartAtMs != scenario.ready || attack.AttackSpeed != 1 {
			t.Fatal(attack)
		}
		if state.basicAttackEventCurrent(scheduler.GenericEvent{TimeMs: 1000, BasicAttackGeneration: 1}) {
			t.Fatal("old attack node remained effective")
		}
		if err := state.runLoop(); err != nil {
			t.Fatal(err)
		}
		if state.attackRecords[1].StartAtMs != scenario.ready {
			t.Fatal(state.attackRecords)
		}
	}
}

func TestContinuousWaitingBudgetFailureDoesNotPublishSpeedOrClock(t *testing.T) {
	state := waitingTestState(t)
	state.budget.MaxCommandsPerEvent = 0
	frame := changeWaitingSpeed(t, state, 400, 2)
	if !frame.fatal || frame.fatalErr.BudgetCause != model.BudgetCauseMaxCommandsPerEvent || state.combatants["source"].attributes.At("attack_speed").Resolved != 1 || state.basicAttack.wait.ready != 1000 || state.heap.Len() != 1 {
		t.Fatal(frame.fatalErr, state.basicAttack.wait)
	}
}

func TestContinuousWaitingFloatingIntegerBoundaryAndPositiveFraction(t *testing.T) {
	elapsed, previousPeriod := float64(350), float64(500)
	remaining := 1 - elapsed/previousPeriod
	if delay := basicAttackRemainingDelay(remaining, 1000); delay != 300 {
		t.Fatal(delay)
	}
	if delay := basicAttackRemainingDelay(.3001, 1000); delay != 301 {
		t.Fatal(delay)
	}
	if delay := basicAttackRemainingDelay(1e-300, 1); delay != 1 {
		t.Fatal(delay)
	}
	if delay := basicAttackRemainingDelay(0, 1); delay != 0 {
		t.Fatal(delay)
	}
}

func TestContinuousWaitingAttackBudgetClearsFinalSchedule(t *testing.T) {
	input, request := continuousAttackInput(1, 10000, 100, 0, 0, 4000)
	request.SafetyBudget = &model.RunSafetyBudget{MaxBasicAttacks: 2}
	done := authoringRun(t, input, request)
	if done.Summary.Execution.Complete || done.Summary.Execution.BudgetCause == nil || *done.Summary.Execution.BudgetCause != model.BudgetCauseMaxBasicAttacks || done.AttackRecords[1].NextStartAtMs != nil {
		t.Fatal(done.Summary, done.AttackRecords)
	}
}

func TestContinuousWaitingBeyondWindowCanReturnIntoWindow(t *testing.T) {
	state := waitingTestState(t)
	state.durationMs = 900
	state.publishBasicAttackWait()
	if state.basicAttack.current.NextStartAtMs != nil {
		t.Fatal(state.basicAttack.current)
	}
	frame := changeWaitingSpeed(t, state, 400, 2)
	if frame.fatal || state.basicAttack.windowSettled || state.basicAttack.current.NextStartAtMs == nil || *state.basicAttack.current.NextStartAtMs != 700 {
		t.Fatal(frame.fatalErr, state.basicAttack.current)
	}
}

func TestSourceStateExpiryRejectsStaleExpiry(t *testing.T) {
	state := waitingTestState(t)
	actor := state.combatants["source"]
	actor.providerState["test-stack"] = &providerStateBag{state: map[string]float64{"stack": 1}, expireAt: map[string]int64{"stack": 400}, fieldDefs: map[string]providerStateFieldDef{"stack": {defaultValue: 0}}}
	state.combatants["source"] = actor
	state.nowMs = 400
	state.applyProviderSourceStateExpiry(expireCleanupPayload{kind: "provider_source_state", combatantKey: "source", providerRef: "test-stack", stateKey: "stack", expectedExpireAt: 300})
	if state.combatants["source"].providerState["test-stack"].state["stack"] != 1 {
		t.Fatal("stale expiry cleared current state")
	}
	state.applyProviderSourceStateExpiry(expireCleanupPayload{kind: "provider_source_state", combatantKey: "source", providerRef: "test-stack", stateKey: "stack", expectedExpireAt: 400})
	if state.processFailure != nil || state.combatants["source"].providerState["test-stack"].state["stack"] != 0 {
		t.Fatal(state.processFailure)
	}
}

func TestContinuousTimedEquipmentStacksExpireDuringWait(t *testing.T) {
	input, request := continuousAttackInput(1, 10000, 100, 0, 0, 1200)
	request.DriverPlan.BasicAttack.AttackSpeedInputMax = 10
	for key, amount := range map[string]float64{"bonus_attack_speed_percent": 0, "attack_speed_ratio": 1} {
		input.Combatants[0].Attributes[key] = authoringSlot(amount)
		request.InitialSnapshot.Combatants[0].Attributes[key] = authoringSlot(amount)
	}
	input.Rules.AttributeDerivations = []model.AttributeDerivationDefinition{attackSpeedDerivation("source")}
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: "state_scope/provider", Domain: "state_scope"})
	addOnHitEquipment(&input, &request, 0, 15)
	passive := &input.SharedProviders[len(input.SharedProviders)-1]
	passive.InitialStateSchema = map[string]interface{}{"stacks": map[string]interface{}{"defaultValue": float64(0), "maxValue": float64(4), "durationMs": float64(400), "refreshPolicy": model.ProviderStateRefreshOnWrite}}
	passive.Modifiers = []model.ModifierDefinition{{ModifierKey: "stack-speed", Kind: "attribute", Target: "self.attr.bonus_attack_speed_percent", ValuePolicy: "add", Value: model.GenericFormulaExpr{Op: "read", Path: "provider.state.stacks"}}}
	passive.Listeners[0].Operations = append(passive.Listeners[0].Operations, model.OperationDefinition{Operation: "state_change", Target: "self", Ref: "stacks", Types: []string{"state_scope/provider"}, ValuePolicy: "add", Amount: authoringAmount(authoringConst(1))})
	done := authoringRun(t, input, request)
	if !done.Summary.Execution.Complete || done.Summary.BasicAttack.CompletedCount != 3 || len(done.AttackRecords) != 3 {
		t.Fatal(done.Summary, done.AttackRecords)
	}
	for index, attack := range done.AttackRecords {
		if attack.StartAtMs != int64(index)*600 || attack.AttackSpeed != 1 {
			t.Fatal(done.AttackRecords)
		}
	}
	if *done.AttackRecords[0].ReadyAtMs != 1000 || *done.AttackRecords[0].FinalReadyAtMs != 600 {
		t.Fatal(done.AttackRecords[0])
	}
}
