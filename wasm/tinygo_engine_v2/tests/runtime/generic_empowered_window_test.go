// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	reflect "reflect"
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

func countedEmpoweredInput(t *testing.T, at, window, duration int64, count float64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	input, request := empoweredInput(t, "finite_window", at, window, duration)
	p := &input.SharedProviders[len(input.SharedProviders)-1]
	consume := "ATTACK_START"
	p.Processes[0].Steps[0].ConsumeMoment = &consume
	p.Processes[0].Steps[0].MaximumAttackCount = timedShieldExpr(count)
	p.Processes[0].Cooldown.DurationMs = authoringConst(8000)
	p.Processes[0].Cooldown.StartMoment = model.ProcessMomentDefinition{MomentType: "PROCESS_COMPLETE"}
	return input, request
}

func TestCountedEmpoweredWindowExpiryWinsAtEqualTimeAndStartsCooldown(t *testing.T) {
	for _, window := range []int64{5999, 6000, 6001} {
		input, request := countedEmpoweredInput(t, 0, window, 6500, 3)
		setCombatantAttr(&input, &request, "source", "attack_speed", authoringSlot(1.0/3))
		done := authoringRun(t, input, request)
		p := empoweredProcess(t, done, "skill:finite_window_first")
		count, damage, end := 2, float64(230), window
		if window == 6001 {
			count, damage, end = 3, 330, 6000
		}
		if p.Status != "complete" || p.FailureReason != nil || p.EmpoweredAttackWindow.ConsumptionCount != count || p.EmpoweredAttackWindow.PendingHitCount != 0 || *p.FinishedAtMs != end || done.Summary.SourceDamageDealt != damage || done.Summary.SkillUses.CompletedCount != 1 || done.Summary.SkillUses.FailedCount != 0 {
			t.Fatal(window, p, done.Summary)
		}
		found := false
		for _, cooldown := range done.FinalSnapshot.Combatants[0].Cooldowns {
			row, ok := cooldown.(map[string]interface{})
			found = found || ok && row["readyAtMs"] == end+8000
		}
		if !found {
			t.Fatal(window, "expiry did not start cooldown", done.FinalSnapshot)
		}
	}
}

func TestCountedEmpoweredWindowCannotReopenWhileActive(t *testing.T) {
	input, request := countedEmpoweredInput(t, 100, 6000, 2200, 3)
	again := request.DriverPlan.SkillActions[0]
	again.InstructionKey, again.FirstAtMs = "too_early", 1500
	request.DriverPlan.SkillActions = append(request.DriverPlan.SkillActions, again)
	done := authoringRun(t, input, request)
	p := empoweredProcess(t, done, "skill:finite_window_first")
	if p.Status != "active" || p.EmpoweredAttackWindow.ConsumptionCount != 2 || done.Summary.SkillUses.StartedCount != 1 || done.Summary.SkillActions.AcceptedCount != 1 {
		t.Fatal(p, done.Summary)
	}
}

func TestCountedEmpoweredWindowPayloadReadsOnlyFrozenSceneValue(t *testing.T) {
	input, request := countedEmpoweredInput(t, 100, 6000, 4000, 3)
	definition := formuladefinition.FromExpr("frozen_spikes", "finite_window", authoringBinary("add", authoringConst(10), authoringBinary("mul", authoringConst(6), authoringRead("ability.param.feast"))), nil)
	definition.Parameters[0].ValueType = "INTEGER"
	definition.Parameters[0].RuntimeSource = &model.FormulaRuntimeSource{Kind: "scene_parameter", Value: model.Float64Ptr(3)}
	input.Formulas = append(input.Formulas, definition)
	input.SharedProviders[len(input.SharedProviders)-1].Abilities[1].Operations[0].SkillHit.Candidates[0].Operations[0].Amount = &model.GenericFormulaExpr{Op: "ref", Ref: "frozen_spikes"}
	compiled := authoringCompile(t, input)
	first, err := runtimeengine.RunGeneric(compiled, request)
	if err != nil || first.Summary.SourceDamageDealt != 134 {
		t.Fatal(err, first.Summary)
	}
	second, err := runtimeengine.RunGeneric(compiled, request)
	if err != nil || !reflect.DeepEqual(first, second) {
		t.Fatal("frozen scene value changed across runs", err)
	}
}

func TestCountedEmpoweredWindowCompileRejectsBadModeCountAndReplacement(t *testing.T) {
	for _, change := range []string{"zero", "fraction", "large", "dynamic", "missing_ref", "hit", "no_count", "wrong_step", "replace", "early_cooldown"} {
		input, _ := countedEmpoweredInput(t, 100, 6000, 4000, 3)
		provider := &input.SharedProviders[len(input.SharedProviders)-1]
		step := &provider.Processes[0].Steps[0]
		switch change {
		case "zero":
			step.MaximumAttackCount = timedShieldExpr(0)
		case "fraction":
			step.MaximumAttackCount = timedShieldExpr(1.5)
		case "large":
			step.MaximumAttackCount = timedShieldExpr(65)
		case "dynamic":
			value := authoringRead("source.attr.attack_damage")
			step.MaximumAttackCount = &value
		case "missing_ref":
			step.MaximumAttackCount = &model.GenericFormulaExpr{Op: "ref", Ref: "missing_formula"}
		case "hit":
			value := "ATTACK_HIT"
			step.ConsumeMoment = &value
		case "no_count":
			step.MaximumAttackCount = nil
		case "wrong_step":
			step.StepType = "IMMEDIATE"
		case "replace":
			provider.Abilities[1].Operations[0].SkillHit.Candidates[0].AttackDamageRole = model.AttackDamageRoleReplacePrimary
		case "early_cooldown":
			provider.Processes[0].Cooldown.StartMoment = model.ProcessMomentDefinition{MomentType: "PROCESS_START"}
		}
		if result := compilebundle.CompileGeneric(input); result.OK {
			t.Fatal("unsupported quota mode accepted", change)
		}
	}
}
