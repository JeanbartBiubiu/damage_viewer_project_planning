// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	json "encoding/json"
	reflect "reflect"
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
)

func channelWindowInput(duration, count, first, last int64) (model.CompileRequest, model.RunRequest) {
	input, request := complexSkillInput("CHANNEL", true)
	step := &input.SharedProviders[0].Processes[0].Steps[0]
	mode := "CUSTOM_WINDOW"
	step.DurationMs, step.ExecutionCount, step.FirstExecution = timedShieldExpr(float64(duration)), timedShieldExpr(float64(count)), &mode
	step.FirstExecutionOffsetMs, step.LastExecutionOffsetMs = timedShieldExpr(float64(first)), timedShieldExpr(float64(last))
	request.DriverPlan.SkillActions[0].FirstAtMs = 0
	request.StopPolicy.DurationMs = duration
	hp := model.AttributeSlotDef{Base: 100000, Current: 100000, Max: 100000, Resolved: 100000}
	input.Combatants[1].Attributes["hp"], request.InitialSnapshot.Combatants[1].Attributes["hp"] = hp, hp
	return input, request
}

func TestComplexSkillChannelWindowAbsoluteTimesAndFullDuration(test *testing.T) {
	input, request := channelWindowInput(3000, 14, 50, 2900)
	done := timedShieldMustRun(test, input, request)
	expected := []int64{50, 269, 488, 708, 927, 1146, 1365, 1585, 1804, 2023, 2242, 2462, 2681, 2900}
	if len(done.DamageRecords) != len(expected) || done.Summary.SkillUses.ReleasedCount != 14 || done.Summary.SkillUses.HitCount != 14 || done.Summary.SkillUses.CompletedCount != 1 || done.Summary.SourceDamageDealt != 1400 {
		test.Fatal(done.Summary, done.DamageRecords)
	}
	for index, expectedAt := range expected {
		if done.DamageRecords[index]["timeMs"] != expectedAt {
			test.Fatal(index, done.DamageRecords[index], expectedAt)
		}
	}
	process := done.FinalSnapshot.ProcessInstances[0]
	if process.Repeat.FirstExecutionOffsetMs != 50 || process.Repeat.LastExecutionOffsetMs != 2900 || process.Repeat.ExecutionCount != 14 || process.Repeat.ExecutionIndex != 14 || process.StepExecutionIndex != 14 || *process.LastExecutionAtMs != 2900 || *process.StepCompletedAtMs != 3000 || *process.FinishedAtMs != 3000 || *process.ExpiresAtMs != 3000 || process.Repeat.NextExecutionAtMs != nil || process.ActionOccupancies[0].ExpectedEndAtMs != 3000 || *process.ActionOccupancies[0].FinishedAtMs != 3000 {
		test.Fatal(process)
	}
	encoded, err := json.Marshal(struct {
		CompileRequest model.CompileRequest `json:"compileRequest"`
		RunRequest     model.RunRequest     `json:"runRequest"`
	}{input, request})
	if err != nil {
		test.Fatal(err)
	}
	test.Logf("channel_window_request=%s", encoded)
	request.StopPolicy.DurationMs = 2999
	pending := timedShieldMustRun(test, input, request)
	process = pending.FinalSnapshot.ProcessInstances[0]
	if process.Status != "active" || process.Repeat.NextExecutionAtMs != nil || process.StepCompletedAtMs != nil || process.ActionOccupancies[0].FinishedAtMs != nil || pending.Summary.SkillUses.InFlightCount != 1 || pending.Summary.SkillUses.CompletedCount != 0 || pending.Summary.SkillUses.HitCount != 14 {
		test.Fatal(process, pending.Summary)
	}
	request.DriverPlan.SkillActions[0].FirstAtMs = 123
	request.StopPolicy.DurationMs = 3123
	shifted := timedShieldMustRun(test, input, request)
	for index, expectedAt := range expected {
		if shifted.DamageRecords[index]["timeMs"] != expectedAt+123 {
			test.Fatal("absolute segment rounding changed with the step start", shifted.DamageRecords[index])
		}
	}
}

func TestComplexSkillChannelWindowOccupiesUntilCompleteAndCancelWakesOnce(test *testing.T) {
	for _, cancel := range []bool{false, true} {
		input, request := continuousAttackInput(1, 100000, 10, 0, 0, 4000)
		addMixedSpell(&input, &request, "window", 0, 3000, true)
		channel, _ := channelWindowInput(3000, 14, 50, 2900)
		step := channel.SharedProviders[0].Processes[0].Steps[0]
		input.SharedProviders[1].Processes[0].Steps = []model.ProcessStepDefinition{step}
		input.Rules.SkillActionBindings[0].HitBindings[0].Moment = model.ProcessMomentDefinition{MomentType: "STEP_EXECUTION", StepKey: &step.StepKey}
		ready := int64(3000)
		if cancel {
			ready = 2950
			addComplexControl(&input, &request, "cancel", "CANCEL", ready, 1)
		}
		done := authoringRun(test, input, request)
		if done.Summary.SkillUses.HitCount != 14 || done.Summary.BasicAttack.StartedCount != 2 || done.Summary.BasicAttack.InitialActionReadyAtMs == nil || *done.Summary.BasicAttack.InitialActionReadyAtMs != ready || len(done.AttackRecords) != 2 || done.AttackRecords[0].StartAtMs != ready || done.AttackRecords[1].StartAtMs != ready+1000 {
			test.Fatal(cancel, done.Summary, done.AttackRecords)
		}
		for _, process := range done.FinalSnapshot.ProcessInstances {
			if process.SkillKey == "window" && (process.ActionOccupancies[0].ExpectedEndAtMs != 3000 || *process.ActionOccupancies[0].FinishedAtMs != ready || process.Repeat.NextExecutionAtMs != nil) {
				test.Fatal(process)
			}
		}
	}
}

func TestComplexSkillChannelWindowZeroDetailsAndSessionRepeat(test *testing.T) {
	input, request := channelWindowInput(3000, 14, 50, 2900)
	compiled := compilebundle.CompileGeneric(input)
	if !compiled.OK {
		test.Fatal(compiled.Result.Errors)
	}
	request.ExpectedRulesHash = compiled.Session.RulesHash
	baseline, err := runtimeengine.RunGeneric(compiled.Session, request)
	if err != nil {
		test.Fatal(err)
	}
	for iteration := 0; iteration < 20; iteration++ {
		done, err := runtimeengine.RunGeneric(compiled.Session, request)
		if err != nil || !reflect.DeepEqual(baseline, done) {
			test.Fatal(iteration, err)
		}
	}
	zero := 0
	request.RecordBudget = &model.RecordBudget{MaxSkillActionRecords: &zero, MaxSkillUseRecords: &zero, MaxDamageRecords: &zero, MaxHealingRecords: &zero}
	request.Sampling = model.SamplingConfig{Disabled: true}
	limited, err := runtimeengine.RunGeneric(compiled.Session, request)
	if err != nil || !reflect.DeepEqual(baseline.Summary.SkillUses, limited.Summary.SkillUses) || !reflect.DeepEqual(baseline.FinalSnapshot, limited.FinalSnapshot) || len(limited.SkillActionRecords)+len(limited.SkillUseRecords)+len(limited.DamageRecords)+len(limited.HealingRecords) != 0 {
		test.Fatal(err, limited.Summary)
	}
}
