package execution

import (
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	scheduler "tinygo_engine_v2/internal/scheduler"
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

func TestAuthoredAbilityParameterChannelUsesActualInitialAbilityAndFrozenProgress(t *testing.T) {
	input, request := snapshotParameterChannelInput()
	done := timedShieldMustRun(t, input, request)
	if done.Summary.SkillUses.HitCount != 14 || done.Summary.SkillUses.CompletedCount != 1 || done.Summary.SourceDamageDealt != 1400 || done.DamageRecords[0]["timeMs"] != int64(0) || done.DamageRecords[13]["timeMs"] != int64(2900) {
		t.Fatal(done.Summary, done.DamageRecords)
	}
	state := frameCommitState(t, input, request)
	if err := state.handleSkillAction(0); err != nil {
		t.Fatal(err)
	}
	for key := range state.compiled.Abilities[0].Params {
		state.compiled.Abilities[0].Params[key] = -1
	}
	restored, err := state.restoreProcess(channelWindowRestoreRow(t, state.snapshotProcesses()[0]), "snapshot")
	if err != nil {
		t.Fatal("restoration read changed initial ability inputs instead of frozen progress", err)
	}
	actionpkg.StageProcess(restored).Publish(state.actions.ProcessAt(0))
	restored = state.actions.ProcessAt(0)
	*state.loop.Queue() = scheduler.NewGenericHeap(64)
	if err := state.enqueueProcessTimer(restored); err != nil {
		t.Fatal(err)
	}
	for state.loop.Queue().Len() > 0 {
		event, _ := state.loop.Queue().Pop()
		state.loop.Advance(event.TimeMs)
		state.currentEventCommands = 0
		if err := state.handleProcessTimer(event); err != nil {
			t.Fatal(err)
		}
	}
	if restored.Repeat().ExecutionCount != 14 || restored.Repeat().ExecutionIndex != 14 || restored.Repeat().FirstExecutionOffsetMs != 0 || restored.Repeat().LastExecutionOffsetMs != 2900 || *restored.LastExecutionAtMs() != 2900 || *restored.FinishedAtMs() != 3000 || state.actions.ManualAt(0).Uses().HitCount != 14 {
		t.Fatal(restored, state.actions.ManualAt(0).Uses())
	}
}
