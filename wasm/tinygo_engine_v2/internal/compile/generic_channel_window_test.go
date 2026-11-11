package compile

import (
	"testing"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

func channelWindowCompileRequest() model.CompileRequest {
	request := processCompileRequest()
	request.SharedProviders[0].Abilities = request.SharedProviders[0].Abilities[:1]
	request.SharedProviders[0].Processes[0].Steps = []model.ProcessStepDefinition{{
		StepKey: "channel", StepType: "CHANNEL", OccupiesAction: model.BoolPtr(true),
		DurationMs: processCompileNumber(3000), ExecutionCount: processCompileNumber(14), FirstExecution: processCompileString("CUSTOM_WINDOW"),
		FirstExecutionOffsetMs: processCompileNumber(50), LastExecutionOffsetMs: processCompileNumber(2900),
	}}
	return request
}

func TestProcessChannelWindowCompileFrozenPrograms(test *testing.T) {
	request := channelWindowCompileRequest()
	result := CompileGeneric(request)
	if !result.OK {
		test.Fatal(result.Result.Errors)
	}
	step := result.Session.Providers[0].Processes[0].Steps[0]
	for _, scenario := range []struct {
		program formula.GenericProgramID
		value   float64
	}{{step.DurationProgram, 3000}, {step.ExecutionCountProgram, 14}, {step.FirstExecutionOffsetProgram, 50}, {step.LastExecutionOffsetProgram, 2900}} {
		value, err := result.Session.Formulas.Evaluation.Eval(scenario.program, formula.GenericEvalContext{})
		if err != nil || value != scenario.value {
			test.Fatal(value, scenario.value, err)
		}
	}
	if step.FirstExecution != "CUSTOM_WINDOW" || !step.OccupiesAction || step.HasInterval {
		test.Fatal(step)
	}
}

func TestProcessChannelWindowCompileRejectsInvalidFields(test *testing.T) {
	for _, scenario := range []struct {
		name   string
		field  string
		change func(*model.ProcessStepDefinition)
	}{
		{"missing_first", "firstExecutionOffsetMs", func(step *model.ProcessStepDefinition) { step.FirstExecutionOffsetMs = nil }},
		{"missing_last", "lastExecutionOffsetMs", func(step *model.ProcessStepDefinition) { step.LastExecutionOffsetMs = nil }},
		{"immediate_first", "firstExecutionOffsetMs", func(step *model.ProcessStepDefinition) { step.FirstExecution = processCompileString("IMMEDIATE") }},
		{"after_interval_last", "lastExecutionOffsetMs", func(step *model.ProcessStepDefinition) { step.FirstExecution = processCompileString("AFTER_INTERVAL") }},
		{"other_step", "firstExecutionOffsetMs", func(step *model.ProcessStepDefinition) { step.StepType = "IMMEDIATE" }},
		{"mixed_interval", "intervalMs", func(step *model.ProcessStepDefinition) { step.IntervalMs = processCompileNumber(10) }},
		{"unknown_mode", "firstExecution", func(step *model.ProcessStepDefinition) { step.FirstExecution = processCompileString("UNKNOWN") }},
		{"zero_duration", "durationMs", func(step *model.ProcessStepDefinition) { step.DurationMs = processCompileNumber(0) }},
		{"unsafe_duration", "durationMs", func(step *model.ProcessStepDefinition) { step.DurationMs = processCompileNumber(9007199254740992) }},
		{"fractional_duration", "durationMs", func(step *model.ProcessStepDefinition) { step.DurationMs = processCompileNumber(3000.5) }},
		{"negative_first", "firstExecutionOffsetMs", func(step *model.ProcessStepDefinition) { step.FirstExecutionOffsetMs = processCompileNumber(-1) }},
		{"fractional_first", "firstExecutionOffsetMs", func(step *model.ProcessStepDefinition) { step.FirstExecutionOffsetMs = processCompileNumber(50.5) }},
		{"unsafe_last", "lastExecutionOffsetMs", func(step *model.ProcessStepDefinition) {
			step.LastExecutionOffsetMs = processCompileNumber(9007199254740992)
		}},
		{"reversed_window", "firstExecutionOffsetMs", func(step *model.ProcessStepDefinition) { step.FirstExecutionOffsetMs = processCompileNumber(2901) }},
		{"past_duration", "lastExecutionOffsetMs", func(step *model.ProcessStepDefinition) { step.LastExecutionOffsetMs = processCompileNumber(3001) }},
		{"insufficient_span", "lastExecutionOffsetMs", func(step *model.ProcessStepDefinition) { step.LastExecutionOffsetMs = processCompileNumber(62) }},
		{"single_requires_equal", "lastExecutionOffsetMs", func(step *model.ProcessStepDefinition) { step.ExecutionCount = processCompileNumber(1) }},
		{"count_zero", "executionCount", func(step *model.ProcessStepDefinition) { step.ExecutionCount = processCompileNumber(0) }},
		{"count_over_max", "executionCount", func(step *model.ProcessStepDefinition) { step.ExecutionCount = processCompileNumber(65) }},
		{"unavailable_context", "firstExecutionOffsetMs", func(step *model.ProcessStepDefinition) {
			step.FirstExecutionOffsetMs = &model.GenericFormulaExpr{Op: "read", Path: "use.charge_duration_ms"}
		}},
	} {
		test.Run(scenario.name, func(test *testing.T) {
			request := channelWindowCompileRequest()
			scenario.change(&request.SharedProviders[0].Processes[0].Steps[0])
			requireProcessCompileError(test, request, "sharedProviders[0].processes[0].steps[0]."+scenario.field)
		})
	}
}

func TestProcessChannelWindowCompileAcceptsNarrowAndSafeLimits(test *testing.T) {
	for _, scenario := range []struct {
		duration float64
		count    float64
		first    float64
		last     float64
	}{{3000, 1, 50, 50}, {63, 64, 0, 63}, {1, 2, 0, 1}, {9007199254740991, 2, 0, 9007199254740991}} {
		request := channelWindowCompileRequest()
		step := &request.SharedProviders[0].Processes[0].Steps[0]
		step.DurationMs, step.ExecutionCount = processCompileNumber(scenario.duration), processCompileNumber(scenario.count)
		step.FirstExecutionOffsetMs, step.LastExecutionOffsetMs = processCompileNumber(scenario.first), processCompileNumber(scenario.last)
		if result := CompileGeneric(request); !result.OK {
			test.Fatal(scenario, result.Result.Errors)
		}
	}
}
