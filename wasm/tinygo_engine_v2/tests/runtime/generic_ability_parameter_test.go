// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	fmt "fmt"
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

func snapshotParameterChannelInput() (model.CompileRequest, model.RunRequest) {
	input, request := channelWindowInput(3000, 14, 0, 2900)
	step := &input.SharedProviders[0].Processes[0].Steps[0]
	formulas := []struct {
		key, parameter string
		expression     **model.GenericFormulaExpr
	}{{"frozen_span", "scene_span", &step.DurationMs}, {"frozen_repeats", "scene_repeats", &step.ExecutionCount}, {"frozen_first", "scene_first", &step.FirstExecutionOffsetMs}, {"frozen_last", "scene_last", &step.LastExecutionOffsetMs}}
	for _, field := range formulas {
		def := formuladefinition.FromExpr(field.key, "configured_spell", model.GenericFormulaExpr{Op: "read", Path: "ability.param." + field.parameter}, nil)
		def.Parameters[0].RuntimeSource = &model.FormulaRuntimeSource{Kind: "ability_parameter"}
		def.Parameters[0].ValueType = "INTEGER"
		input.Formulas = append(input.Formulas, def)
		*field.expression = &model.GenericFormulaExpr{Op: "ref", Ref: field.key}
	}
	input.SharedProviders[0].Abilities[0].Params = map[string]float64{"scene_span": 3000, "scene_repeats": 14, "scene_first": 0, "scene_last": 2900}
	// 逐段结果能力故意不提供相同输入；时间必须沿真实首次能力求值。
	input.SharedProviders[0].Abilities[1].Params = map[string]float64{"scene_repeats": 1}
	return input, request
}

func TestAuthoredAbilityParameterChannelFailsMissingNonintegerAndOutOfRangeCount(t *testing.T) {
	for _, scenario := range []string{"missing", "fraction", "unsafe", "count_zero", "count_over_max", "unbound_source"} {
		t.Run(scenario, func(t *testing.T) {
			input, request := snapshotParameterChannelInput()
			params := input.SharedProviders[0].Abilities[0].Params
			switch scenario {
			case "missing":
				delete(params, "scene_repeats")
			case "fraction":
				params["scene_repeats"] = 3.5
			case "unsafe":
				params["scene_repeats"] = 9007199254740992
			case "count_zero":
				params["scene_repeats"] = 0
			case "count_over_max":
				params["scene_repeats"] = 65
			case "unbound_source":
				input.Formulas[1].Parameters[0].RuntimeSource = nil
			}
			compiled := compilebundle.CompileGeneric(input)
			if scenario == "unbound_source" {
				if compiled.OK {
					t.Fatal("old runtime input borrowed an identically named ability parameter")
				}
				return
			}
			if !compiled.OK {
				t.Fatal(compiled.Result.Errors)
			}
			if _, err := runtimeengine.RunGeneric(compiled.Session, request); err == nil {
				t.Fatal("invalid runtime count was coerced or defaulted")
			}
		})
	}
}

func TestAuthoredAbilityParameterDriverConditionsAndRepeatStayRestricted(t *testing.T) {
	for _, repeat := range []bool{false, true} {
		input, request := snapshotParameterChannelInput()
		request.DriverPlan.SkillActions = nil
		request.DriverPlan.Entries = []model.DriverEntry{{EntryKey: "unrelated_driver", AbilityRef: "source.provider[caster].ability[hit]", Source: "source", Target: "target", FirstAtMs: 0}}
		ref := &model.GenericFormulaExpr{Op: "ref", Ref: "frozen_repeats"}
		if repeat {
			request.DriverPlan.Entries[0].Repeat = &model.DriverRepeat{IntervalFormula: ref}
		} else {
			request.DriverPlan.Entries[0].Condition = ref
		}
		compiled := compilebundle.CompileGeneric(input)
		if !compiled.OK {
			t.Fatal(compiled.Result.Errors)
		}
		if _, err := runtimeengine.RunGeneric(compiled.Session, request); err == nil {
			t.Fatal("driver context borrowed authored ability runtime parameter", repeat)
		}
	}
}

func TestAutomaticFiniteChannelKeepsFullOccupancyCompletionCooldownAndQualification(t *testing.T) {
	input, request := automaticChainInput(t, 2, false)
	first := "CUSTOM_WINDOW"
	input.SharedProviders[0].Processes[0].Steps = []model.ProcessStepDefinition{{StepKey: "actual_channel", StepType: "CHANNEL", OccupiesAction: model.BoolPtr(true), DurationMs: timedShieldExpr(1000), ExecutionCount: timedShieldExpr(4), FirstExecution: &first, FirstExecutionOffsetMs: timedShieldExpr(0), LastExecutionOffsetMs: timedShieldExpr(750)}}
	input.SharedProviders[0].Processes[0].Cooldown.StartMoment = model.ProcessMomentDefinition{MomentType: "PROCESS_COMPLETE"}
	for _, field := range []struct {
		key, parameter string
		expression     **model.GenericFormulaExpr
	}{{"auto_repeats", "authored_loops", &input.SharedProviders[0].Processes[0].Steps[0].ExecutionCount}, {"auto_first", "authored_head", &input.SharedProviders[0].Processes[0].Steps[0].FirstExecutionOffsetMs}, {"auto_last", "authored_tail", &input.SharedProviders[0].Processes[0].Steps[0].LastExecutionOffsetMs}} {
		def := formuladefinition.FromExpr(field.key, "rule0", model.GenericFormulaExpr{Op: "read", Path: "ability.param." + field.parameter}, nil)
		def.Parameters[0].RuntimeSource = &model.FormulaRuntimeSource{Kind: "ability_parameter"}
		def.Parameters[0].ValueType = "INTEGER"
		input.Formulas = append(input.Formulas, def)
		*field.expression = &model.GenericFormulaExpr{Op: "ref", Ref: field.key}
	}
	input.SharedProviders[0].Abilities[0].Params = map[string]float64{"authored_loops": 4, "authored_head": 0, "authored_tail": 750}
	input.Rules.SkillActionBindings[0].HitBindings[0].Moment = model.ProcessMomentDefinition{MomentType: "STEP_EXECUTION", StepKey: &input.SharedProviders[0].Processes[0].Steps[0].StepKey}
	request.StopPolicy.DurationMs = 1100
	done := timedShieldMustRun(t, input, request)
	if done.AutomaticSkillSummary.StartedCount != 2 || done.AutomaticSkillSummary.CompletedCount != 2 || done.Summary.SkillUses.HitCount != 5 {
		t.Fatal(done.AutomaticSkillSummary, done.Summary.SkillUses)
	}
	starts := map[string][]int64{}
	for _, record := range done.AutomaticSkillRecords {
		if record.Kind == model.AutomaticRecordStarted {
			starts[record.RuleKey] = append(starts[record.RuleKey], record.TimeMs)
		}
	}
	if fmt.Sprint(starts["rule0"]) != "[0]" || fmt.Sprint(starts["rule1"]) != "[1000]" {
		t.Fatal("qualification released at last hit instead of full completion, or channel restarted early", starts)
	}
	process := done.FinalSnapshot.ProcessInstances[0]
	if process.Repeat.ExecutionCount != 4 || process.Repeat.ExecutionIndex != 4 || *process.LastExecutionAtMs != 750 || *process.FinishedAtMs != 1000 || *process.ActionOccupancies[0].FinishedAtMs != 1000 || !process.CooldownStarted {
		t.Fatal(process)
	}
	for _, qualification := range done.AutomaticSkillSummary.Qualifications {
		if qualification.GrantedCount != 1 || qualification.ConsumedCount != 1 || qualification.RemainingCount != 0 {
			t.Fatal(qualification)
		}
	}
}
