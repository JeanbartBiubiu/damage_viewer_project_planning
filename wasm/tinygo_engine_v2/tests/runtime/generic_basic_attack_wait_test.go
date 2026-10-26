// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

func TestContinuousWaitingFloatingIntegerBoundaryAndPositiveFraction(t *testing.T) {
	elapsed, previousPeriod := float64(350), float64(500)
	remaining := 1 - elapsed/previousPeriod
	if delay := actionpkg.BasicAttackRemainingDelay(remaining, 1000); delay != 300 {
		t.Fatal(delay)
	}
	if delay := actionpkg.BasicAttackRemainingDelay(.3001, 1000); delay != 301 {
		t.Fatal(delay)
	}
	if delay := actionpkg.BasicAttackRemainingDelay(1e-300, 1); delay != 1 {
		t.Fatal(delay)
	}
	if delay := actionpkg.BasicAttackRemainingDelay(0, 1); delay != 0 {
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
