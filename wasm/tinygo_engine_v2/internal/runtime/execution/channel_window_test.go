package execution

import (
	json "encoding/json"
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	scheduler "tinygo_engine_v2/internal/scheduler"
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

func channelWindowRestoreRow(test *testing.T, row model.ProcessInstanceSnapshot) model.ProcessInstanceSnapshot {
	test.Helper()
	encoded, err := json.Marshal(row)
	if err != nil {
		test.Fatal(err)
	}
	var restored model.ProcessInstanceSnapshot
	if err := json.Unmarshal(encoded, &restored); err != nil {
		test.Fatal(err)
	}
	return restored
}

func channelWindowTime(value int64) *int64 { return &value }

func TestComplexSkillChannelWindowCountBoundaries(test *testing.T) {
	for _, scenario := range []struct {
		name     string
		duration int64
		count    int64
		first    int64
		last     int64
		times    []int64
	}{
		{"single_early", 3000, 1, 50, 50, []int64{50}},
		{"single_immediate", 1, 1, 0, 0, []int64{0}},
		{"single_at_end", 3, 1, 3, 3, []int64{3}},
		{"one_ms_two_segments", 1, 2, 0, 1, []int64{0, 1}},
		{"maximum_count", 63, 64, 0, 63, nil},
	} {
		test.Run(scenario.name, func(test *testing.T) {
			input, request := channelWindowInput(scenario.duration, scenario.count, scenario.first, scenario.last)
			done := timedShieldMustRun(test, input, request)
			if done.Summary.SkillUses.HitCount != int(scenario.count) || done.Summary.SkillUses.StepExecutedCount != int(scenario.count) || done.Summary.SkillUses.CompletedCount != 1 || len(done.DamageRecords) != int(scenario.count) {
				test.Fatal(done.Summary)
			}
			for index, record := range done.DamageRecords {
				expected := int64(index)
				if scenario.times != nil {
					expected = scenario.times[index]
				}
				if record["timeMs"] != expected {
					test.Fatal(index, record, expected)
				}
			}
			state := frameCommitState(test, input, request)
			state.loop.Advance(done.FinalSnapshot.TimeMs)
			if _, err := state.restoreProcess(channelWindowRestoreRow(test, done.FinalSnapshot.ProcessInstances[0]), "snapshot"); err != nil {
				test.Fatal("count boundary snapshot did not restore", err)
			}
		})
	}
}

func TestComplexSkillChannelWindowOldRoundingRemainsUnchanged(test *testing.T) {
	for _, scenario := range []struct {
		mode  string
		times []int64
	}{{"IMMEDIATE", []int64{0, 4, 8, 11}}, {"AFTER_INTERVAL", []int64{4, 8, 11, 15}}} {
		test.Run(scenario.mode, func(test *testing.T) {
			input, request := complexSkillInput("CHANNEL", true)
			step := &input.SharedProviders[0].Processes[0].Steps[0]
			step.DurationMs, step.ExecutionCount, step.FirstExecution = timedShieldExpr(15), timedShieldExpr(4), &scenario.mode
			request.DriverPlan.SkillActions[0].FirstAtMs, request.StopPolicy.DurationMs = 0, 15
			done := timedShieldMustRun(test, input, request)
			for index, expected := range scenario.times {
				if done.DamageRecords[index]["timeMs"] != expected {
					test.Fatal("old channel was interpolated from rounded endpoints", done.DamageRecords)
				}
			}
			process := done.FinalSnapshot.ProcessInstances[0]
			if process.Repeat.FirstExecutionOffsetMs != scenario.times[0] || process.Repeat.LastExecutionOffsetMs != scenario.times[3] {
				test.Fatal(process.Repeat)
			}
			state := frameCommitState(test, input, request)
			state.loop.Advance(15)
			if _, err := state.restoreProcess(channelWindowRestoreRow(test, process), "snapshot"); err != nil {
				test.Fatal(err)
			}
			process.Repeat.LastExecutionOffsetMs--
			if _, err := state.restoreProcess(process, "snapshot"); err == nil {
				test.Fatal("old channel restored forged endpoint proof")
			}
			step.DurationMs = timedShieldExpr(3)
			compiled := compilebundle.CompileGeneric(input)
			if !compiled.OK {
				test.Fatal(compiled.Result.Errors)
			}
			request.ExpectedRulesHash = compiled.Session.RulesHash
			if _, err := runForTest(compiled.Session, request); err == nil {
				test.Fatal("old channel lost its duration >= count constraint")
			}
		})
	}
	input, request := complexSkillInput("MULTI_HIT", true)
	done := timedShieldMustRun(test, input, request)
	if repeat := done.FinalSnapshot.ProcessInstances[0].Repeat; repeat.FirstExecutionOffsetMs != 0 || repeat.LastExecutionOffsetMs != 300 {
		test.Fatal("multi-hit must retain zero and count-minus-one intervals", repeat)
	}
}

func TestComplexSkillChannelWindowCancelAndDeathNeverContinue(test *testing.T) {
	for _, death := range []bool{false, true} {
		input, request := channelWindowInput(3000, 14, 50, 2900)
		executions, hits, finished, reason := 1, 1, int64(268), "ACTIVE_CANCELLED"
		if death {
			hp := input.Combatants[0].Attributes["hp"]
			hp.Current = 250
			input.Combatants[0].Attributes["hp"], request.InitialSnapshot.Combatants[0].Attributes["hp"] = hp, hp
			stepKey := "complex"
			input.SharedProviders[0].Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "STEP_EXECUTION", StepKey: &stepKey}, Operations: []model.OperationDefinition{{Operation: "damage", Target: "self", Amount: timedShieldExpr(100), DamageType: "damage/physical"}}}}
			executions, hits, finished, reason = 3, 2, 488, "SOURCE_DIED"
		} else {
			addComplexControl(&input, &request, "cancel", "CANCEL", finished, 1)
		}
		done := timedShieldMustRun(test, input, request)
		process := done.FinalSnapshot.ProcessInstances[0]
		if process.Status != "failed" || *process.FailureReason != reason || *process.FinishedAtMs != finished || process.Repeat.ExecutionIndex != executions || process.Repeat.NextExecutionAtMs != nil || done.Summary.SkillUses.StepExecutedCount != executions || done.Summary.SkillUses.HitCount != hits || *process.ActionOccupancies[0].FinishedAtMs != finished {
			test.Fatal(death, process, done.Summary)
		}
		state := frameCommitState(test, input, request)
		state.loop.Advance(done.FinalSnapshot.TimeMs)
		if _, err := state.restoreProcess(channelWindowRestoreRow(test, process), "snapshot"); err != nil {
			test.Fatal(err)
		}
		process.Repeat.NextExecutionAtMs = channelWindowTime(708)
		if _, err := state.restoreProcess(process, "snapshot"); err == nil {
			test.Fatal("terminated channel restored another segment")
		}
	}
}

func TestComplexSkillChannelWindowFrozenParametersSurviveRestoration(test *testing.T) {
	input, request := channelWindowInput(3000, 14, 50, 2900)
	step := &input.SharedProviders[0].Processes[0].Steps[0]
	step.DurationMs = &model.GenericFormulaExpr{Op: "read", Path: "ability.param.duration"}
	step.ExecutionCount = &model.GenericFormulaExpr{Op: "read", Path: "ability.param.count"}
	step.FirstExecutionOffsetMs = &model.GenericFormulaExpr{Op: "read", Path: "ability.param.first"}
	step.LastExecutionOffsetMs = &model.GenericFormulaExpr{Op: "read", Path: "ability.param.last"}
	input.SharedProviders[0].Abilities[0].Params = map[string]float64{"duration": 3000, "count": 14, "first": 50, "last": 2900}
	state := frameCommitState(test, input, request)
	if err := state.handleSkillAction(0); err != nil {
		test.Fatal(err)
	}
	for key := range state.compiled.Abilities[0].Params {
		state.compiled.Abilities[0].Params[key] = -1
	}
	restored, err := state.restoreProcess(channelWindowRestoreRow(test, state.snapshotProcesses()[0]), "snapshot")
	if err != nil {
		test.Fatal("restoration re-read changed author parameters", err)
	}
	actionpkg.StageProcess(restored).Publish(state.actions.ProcessAt(0))
	restored = state.actions.ProcessAt(0)
	*state.loop.Queue() = scheduler.NewGenericHeap(64)
	if err := state.enqueueProcessTimer(restored); err != nil {
		test.Fatal(err)
	}
	for state.loop.Queue().Len() > 0 {
		event, _ := state.loop.Queue().Pop()
		state.loop.Advance(event.TimeMs)
		state.currentEventCommands = 0
		if err := state.handleProcessTimer(event); err != nil {
			test.Fatal(err)
		}
	}
	if restored.Repeat().ExecutionIndex != 14 || restored.Repeat().FirstExecutionOffsetMs != 50 || restored.Repeat().LastExecutionOffsetMs != 2900 || *restored.LastExecutionAtMs() != 2900 || *restored.FinishedAtMs() != 3000 || state.actions.ManualAt(0).Uses().HitCount != 14 || state.abilityCastCount != 1 {
		test.Fatal(restored, state.actions.ManualAt(0).Uses())
	}
}

func TestComplexSkillChannelWindowRestorationRejectsForgedProgress(test *testing.T) {
	input, request := channelWindowInput(3000, 14, 50, 2900)
	request.StopPolicy.DurationMs = 270
	done := timedShieldMustRun(test, input, request)
	state := frameCommitState(test, input, request)
	state.loop.Advance(270)
	baseline := channelWindowRestoreRow(test, done.FinalSnapshot.ProcessInstances[0])
	if _, err := state.restoreProcess(baseline, "snapshot"); err != nil {
		test.Fatal(err)
	}
	for name, change := range map[string]func(*model.ProcessInstanceSnapshot){
		"missing_repeat": func(row *model.ProcessInstanceSnapshot) { row.Repeat = nil },
		"count_zero":     func(row *model.ProcessInstanceSnapshot) { row.Repeat.ExecutionCount = 0 },
		"count_over_max": func(row *model.ProcessInstanceSnapshot) { row.Repeat.ExecutionCount = 65 },
		"future_segment": func(row *model.ProcessInstanceSnapshot) {
			row.Repeat.ExecutionIndex, row.StepExecutionIndex = 3, 3
			row.LastExecutionAtMs, row.Repeat.NextExecutionAtMs = channelWindowTime(488), channelWindowTime(708)
		},
		"index_mismatch":  func(row *model.ProcessInstanceSnapshot) { row.StepExecutionIndex++ },
		"wrong_next":      func(row *model.ProcessInstanceSnapshot) { row.Repeat.NextExecutionAtMs = channelWindowTime(487) },
		"missing_next":    func(row *model.ProcessInstanceSnapshot) { row.Repeat.NextExecutionAtMs = nil },
		"wrong_last":      func(row *model.ProcessInstanceSnapshot) { row.LastExecutionAtMs = channelWindowTime(268) },
		"negative_first":  func(row *model.ProcessInstanceSnapshot) { row.Repeat.FirstExecutionOffsetMs = -1 },
		"reversed":        func(row *model.ProcessInstanceSnapshot) { row.Repeat.FirstExecutionOffsetMs = 2901 },
		"past_duration":   func(row *model.ProcessInstanceSnapshot) { row.Repeat.LastExecutionOffsetMs = 3001 },
		"narrow_span":     func(row *model.ProcessInstanceSnapshot) { row.Repeat.LastExecutionOffsetMs = 62 },
		"single_span":     func(row *model.ProcessInstanceSnapshot) { row.Repeat.ExecutionCount = 1 },
		"mixed_interval":  func(row *model.ProcessInstanceSnapshot) { row.Repeat.IntervalMs = 1 },
		"wrong_advance":   func(row *model.ProcessInstanceSnapshot) { row.AdvanceAtMs = 2900 },
		"no_occupancy":    func(row *model.ProcessInstanceSnapshot) { row.ActionOccupancies = []model.ProcessActionOccupancy{} },
		"short_occupancy": func(row *model.ProcessInstanceSnapshot) { row.ActionOccupancies[0].ExpectedEndAtMs = 2900 },
		"late_occupancy":  func(row *model.ProcessInstanceSnapshot) { row.ActionOccupancies[0].StartedAtMs = 1 },
	} {
		test.Run(name, func(test *testing.T) {
			row := channelWindowRestoreRow(test, baseline)
			change(&row)
			if _, err := state.restoreProcess(row, "snapshot"); err == nil {
				test.Fatal("forged frozen channel restored", row)
			}
		})
	}
	state.compiled.Providers[0].Processes[0].Steps[0].FirstExecution = "IMMEDIATE"
	if _, err := state.restoreProcess(baseline, "snapshot"); err == nil {
		test.Fatal("channel window restored under a different execution mode")
	}
}

func TestComplexSkillChannelWindowRestoreAfterLastWaitsForFullDeadline(test *testing.T) {
	input, request := channelWindowInput(3000, 14, 50, 2900)
	state := frameCommitState(test, input, request)
	if err := state.handleSkillAction(0); err != nil {
		test.Fatal(err)
	}
	for state.actions.ProcessAt(0).Repeat().ExecutionIndex < 14 {
		event, _ := state.loop.Queue().Pop()
		state.loop.Advance(event.TimeMs)
		state.currentEventCommands = 0
		if err := state.handleProcessTimer(event); err != nil {
			test.Fatal(err)
		}
	}
	state.loop.Advance(2999)
	restored, err := state.restoreProcess(channelWindowRestoreRow(test, state.snapshotProcesses()[0]), "snapshot")
	if err != nil || !restored.OccupiesAction("source") || restored.TimerAt() != 3000 {
		test.Fatal(restored, err)
	}
	actionpkg.StageProcess(restored).Publish(state.actions.ProcessAt(0))
	restored = state.actions.ProcessAt(0)
	*state.loop.Queue() = scheduler.NewGenericHeap(2)
	if err := state.enqueueProcessTimer(restored); err != nil {
		test.Fatal(err)
	}
	event, _ := state.loop.Queue().Pop()
	state.loop.Advance(event.TimeMs)
	state.currentEventCommands = 0
	if err := state.handleProcessTimer(event); err != nil || state.actions.ManualAt(0).Uses().HitCount != 14 || restored.Status() != "complete" || restored.OccupiesAction("source") {
		test.Fatal("restoration repeated a segment or shortened full occupancy", restored, err)
	}
	row := channelWindowRestoreRow(test, state.snapshotProcesses()[0])
	row.ActionOccupancies[0].ExpectedEndAtMs = 4000
	if _, err := state.restoreProcess(row, "snapshot"); err == nil {
		test.Fatal("terminal occupancy restored a forged full deadline")
	}
	row = channelWindowRestoreRow(test, state.snapshotProcesses()[0])
	row.ActionOccupancies[0].FinishedAtMs = channelWindowTime(2999)
	if _, err := state.restoreProcess(row, "snapshot"); err == nil {
		test.Fatal("terminal occupancy restored a forged actual exit")
	}
}

func TestComplexSkillChannelWindowQueueBoundaryIsAtomicAndOnlyNextEvent(test *testing.T) {
	input, request := channelWindowInput(3000, 14, 50, 2900)
	state := frameCommitState(test, input, request)
	*state.loop.Queue() = scheduler.NewGenericHeap(64)
	if err := state.handleSkillAction(0); err != nil || state.loop.Queue().Len() != 1 {
		test.Fatal(err, state.loop.Queue().Len())
	}
	process := state.actions.ProcessAt(0)
	*state.loop.Queue() = scheduler.NewGenericHeap(1)
	state.loop.Queue().SetLimit(1)
	state.loop.Queue().Push(scheduler.GenericEvent{TimeMs: 5000})
	state.loop.Advance(50)
	if err := state.executeProcessRepeat(process); err == nil || err.BudgetCause != model.BudgetCauseMaxQueueEvents {
		test.Fatal(err)
	}
	if process.Repeat().ExecutionIndex != 0 || process.StepExecutionIndex() != 0 || *process.Repeat().NextExecutionAtMs != 50 || state.combatantHp("target") != 100000 || state.actions.ManualAt(0).Uses().HitCount != 0 || !process.OccupiesAction("source") {
		test.Fatal("uncommitted segment or permission leaked", process, state.actions.ManualAt(0).Uses())
	}
	*state.loop.Queue() = scheduler.NewGenericHeap(2)
	state.loop.Queue().SetLimit(2)
	state.loop.Queue().Push(scheduler.GenericEvent{TimeMs: 5000})
	if err := state.executeProcessRepeat(process); err != nil || state.loop.Queue().Len() != 2 || process.Repeat().ExecutionIndex != 1 || *process.Repeat().NextExecutionAtMs != 269 {
		test.Fatal("channel did not enqueue only the next real event", process, state.loop.Queue().Len(), err)
	}
	for process.Repeat().ExecutionIndex < 13 {
		event, _ := state.loop.Queue().Pop()
		state.loop.Advance(event.TimeMs)
		state.currentEventCommands = 0
		if err := state.handleProcessTimer(event); err != nil {
			test.Fatal(err)
		}
	}
	*state.loop.Queue() = scheduler.NewGenericHeap(1)
	state.loop.Queue().SetLimit(1)
	state.loop.Queue().Push(scheduler.GenericEvent{TimeMs: 5000})
	state.loop.Advance(2900)
	state.currentEventCommands = 0
	if err := state.executeProcessRepeat(process); err == nil || err.BudgetCause != model.BudgetCauseMaxQueueEvents || process.Repeat().ExecutionIndex != 13 || process.ActionOccupancies()[0].FinishedAtMs != nil {
		test.Fatal("last execution unlocked before its complete-duration event could commit", process, err)
	}
}

func TestComplexSkillChannelWindowOldFrozenTimingSurvivesRestoration(test *testing.T) {
	for _, scenario := range []struct {
		mode  string
		times []int64
	}{{"IMMEDIATE", []int64{0, 4, 8, 11}}, {"AFTER_INTERVAL", []int64{4, 8, 11, 15}}} {
		test.Run(scenario.mode, func(test *testing.T) {
			input, request := complexSkillInput("CHANNEL", true)
			step := &input.SharedProviders[0].Processes[0].Steps[0]
			step.DurationMs, step.ExecutionCount = &model.GenericFormulaExpr{Op: "read", Path: "ability.param.duration"}, &model.GenericFormulaExpr{Op: "read", Path: "ability.param.count"}
			step.FirstExecution = &scenario.mode
			input.SharedProviders[0].Abilities[0].Params = map[string]float64{"duration": 15, "count": 4}
			request.DriverPlan.SkillActions[0].FirstAtMs, request.StopPolicy.DurationMs = 0, 15
			state := frameCommitState(test, input, request)
			*state.loop.Queue() = scheduler.NewGenericHeap(8)
			if err := state.handleSkillAction(0); err != nil {
				test.Fatal(err)
			}
			state.compiled.Abilities[0].Params["duration"], state.compiled.Abilities[0].Params["count"] = 1, 64
			restored, err := state.restoreProcess(channelWindowRestoreRow(test, state.snapshotProcesses()[0]), "snapshot")
			if err != nil {
				test.Fatal("old channel restoration re-read author parameters", err)
			}
			actionpkg.StageProcess(restored).Publish(state.actions.ProcessAt(0))
			restored = state.actions.ProcessAt(0)
			*state.loop.Queue() = scheduler.NewGenericHeap(8)
			if err := state.enqueueProcessTimer(restored); err != nil {
				test.Fatal(err)
			}
			for state.loop.Queue().Len() > 0 {
				event, _ := state.loop.Queue().Pop()
				state.loop.Advance(event.TimeMs)
				state.currentEventCommands = 0
				if err := state.handleProcessTimer(event); err != nil {
					test.Fatal(err)
				}
			}
			done := state.buildDoneResult(false)
			if len(done.DamageRecords) != 4 || state.actions.ManualAt(0).Uses().HitCount != 4 || *restored.FinishedAtMs() != 15 {
				test.Fatal(restored, state.actions.ManualAt(0).Uses())
			}
			for index, expected := range scenario.times {
				if done.DamageRecords[index]["timeMs"] != expected {
					test.Fatal("old restored channel was interpolated from rounded proof endpoints", done.DamageRecords)
				}
			}
		})
	}
}

func TestComplexSkillChannelWindowDynamicValidation(test *testing.T) {
	for _, scenario := range []struct {
		name  string
		field string
		value float64
	}{
		{"zero_duration", "duration", 0}, {"unsafe_duration", "duration", 9007199254740992}, {"fractional_duration", "duration", 3000.5},
		{"negative_first", "first", -1}, {"fractional_first", "first", 50.5}, {"unsafe_first", "first", 9007199254740992},
		{"reversed", "first", 2901}, {"past_duration", "last", 3001}, {"narrow_span", "last", 62},
		{"count_zero", "count", 0}, {"count_over_max", "count", 65}, {"count_fractional", "count", 14.5}, {"single_span", "count", 1},
	} {
		test.Run(scenario.name, func(test *testing.T) {
			input, request := channelWindowInput(3000, 14, 50, 2900)
			step := &input.SharedProviders[0].Processes[0].Steps[0]
			step.DurationMs = &model.GenericFormulaExpr{Op: "read", Path: "ability.param.duration"}
			step.ExecutionCount = &model.GenericFormulaExpr{Op: "read", Path: "ability.param.count"}
			step.FirstExecutionOffsetMs = &model.GenericFormulaExpr{Op: "read", Path: "ability.param.first"}
			step.LastExecutionOffsetMs = &model.GenericFormulaExpr{Op: "read", Path: "ability.param.last"}
			params := map[string]float64{"duration": 3000, "count": 14, "first": 50, "last": 2900}
			params[scenario.field] = scenario.value
			input.SharedProviders[0].Abilities[0].Params = params
			state := frameCommitState(test, input, request)
			if err := state.handleSkillAction(0); err == nil {
				test.Fatal("invalid live window accepted", scenario)
			}
			if process := state.actions.ProcessAt(0); process.StepVersion() != 0 || process.Repeat() != nil || len(process.ActionOccupancies()) != 0 || state.actions.ManualAt(0).Uses().HitCount != 0 {
				test.Fatal("invalid step published frozen progress or occupancy", process)
			}
		})
	}
}

func TestComplexSkillChannelWindowSafeIntegerBoundary(test *testing.T) {
	input, request := channelWindowInput(maxJSONSafeInteger, 2, maxJSONSafeInteger-1, maxJSONSafeInteger)
	request.StopPolicy.DurationMs = 1
	done := timedShieldMustRun(test, input, request)
	row := channelWindowRestoreRow(test, done.FinalSnapshot.ProcessInstances[0])
	if row.Repeat.FirstExecutionOffsetMs != maxJSONSafeInteger-1 || row.Repeat.LastExecutionOffsetMs != maxJSONSafeInteger || *row.Repeat.NextExecutionAtMs != maxJSONSafeInteger-1 || *row.ExpiresAtMs != maxJSONSafeInteger || row.StepExecutionIndex != 0 {
		test.Fatal("safe offsets were narrowed or prematurely executed", row)
	}
	state := frameCommitState(test, input, request)
	if _, err := state.restoreProcess(row, "snapshot"); err != nil {
		test.Fatal(err)
	}
	row.AdvanceAtMs, row.ExpiresAtMs = maxJSONSafeInteger+1, channelWindowTime(maxJSONSafeInteger+1)
	if _, err := state.restoreProcess(row, "snapshot"); err == nil {
		test.Fatal("unsafe frozen channel duration restored")
	}
	state.loop.Advance(1)
	if err := state.handleSkillAction(0); err == nil {
		test.Fatal("safe duration was allowed to create an unsafe absolute deadline")
	}
	if process := state.actions.ProcessAt(0); process.StepVersion() != 0 || process.Repeat() != nil || len(process.ActionOccupancies()) != 0 {
		test.Fatal("unsafe absolute deadline published a step", process)
	}
}

func TestComplexSkillChannelWindowRoundingRetainsSafeIntegerEndpoints(test *testing.T) {
	for _, scenario := range []struct {
		count int
		first int64
		last  int64
		slot  int
		want  int64
	}{
		{3, 50, maxJSONSafeInteger, 1, 4503599627370521},
		{4, 0, maxJSONSafeInteger, 1, 3002399751580330},
		{4, 0, maxJSONSafeInteger - 1, 3, maxJSONSafeInteger - 1},
		{14, 50, maxJSONSafeInteger, 13, maxJSONSafeInteger},
		{14, 0, maxJSONSafeInteger, 10, 6928614811339224},
		{64, 0, maxJSONSafeInteger, 1, 142971416741920},
		{64, maxJSONSafeInteger - 63, maxJSONSafeInteger, 62, maxJSONSafeInteger - 1},
	} {
		process := actionpkg.NewProcess(actionpkg.ProcessSeed{Snapshot: model.ProcessInstanceSnapshot{Repeat: &model.ProcessRepeatSnapshot{ExecutionCount: scenario.count, FirstExecutionOffsetMs: scenario.first, LastExecutionOffsetMs: scenario.last}}, Definition: &planbundle.CompiledProcess{Steps: []planbundle.CompiledProcessStep{{StepType: "CHANNEL", FirstExecution: "CUSTOM_WINDOW"}}}})
		if offset := process.RepeatOffset(scenario.slot); offset != scenario.want {
			test.Fatal("absolute rounding lost a safe integer millisecond", scenario, offset)
		}
		if first, last := process.RepeatOffset(0), process.RepeatOffset(scenario.count-1); first != scenario.first || last != scenario.last {
			test.Fatal("safe frozen endpoints were changed by intermediate arithmetic", scenario, first, last)
		}
	}
}

func TestComplexSkillChannelWindowRestoreBudgetInterruptedCompletion(test *testing.T) {
	input, request := channelWindowInput(3000, 1, 3000, 3000)
	input.SharedProviders[0].Abilities = input.SharedProviders[0].Abilities[:1]
	input.Rules.SkillActionBindings[0].HitBindings = []model.SkillActionHitBinding{}
	request.DriverPlan.SkillActions[0].HitBindings = []model.SkillActionHitPreset{}
	stepKey := "complex"
	input.SharedProviders[0].Processes[0].MomentOperations = []model.ProcessMomentOperations{
		{Moment: model.ProcessMomentDefinition{MomentType: "STEP_EXECUTION", StepKey: &stepKey}, Operations: []model.OperationDefinition{{Operation: "damage", Target: "self", Amount: timedShieldExpr(10), DamageType: "damage/physical"}}},
		{Moment: model.ProcessMomentDefinition{MomentType: "STEP_COMPLETE", StepKey: &stepKey}, Operations: []model.OperationDefinition{{Operation: "damage", Target: "self", Amount: timedShieldExpr(20), DamageType: "damage/physical"}}},
	}
	state := frameCommitState(test, input, request)
	if err := state.handleSkillAction(0); err != nil {
		test.Fatal(err)
	}
	state.loop.Advance(3000)
	state.currentEventCommands, state.budget.MaxCommandsPerEvent = 0, 1
	if err := state.executeProcessRepeat(state.actions.ProcessAt(0)); err == nil || err.BudgetCause != model.BudgetCauseMaxCommandsPerEvent {
		test.Fatal(err)
	}
	row := state.snapshotProcesses()[0]
	if row.Repeat.ExecutionIndex != 1 || row.Repeat.NextExecutionAtMs != nil || *row.LastExecutionAtMs != 3000 || row.StepCompletedAtMs != nil || state.combatantHp("source") != 490 {
		test.Fatal(row)
	}
	restored, err := state.restoreProcess(channelWindowRestoreRow(test, row), "snapshot")
	if err != nil {
		test.Fatal(err)
	}
	actionpkg.StageProcess(restored).Publish(state.actions.ProcessAt(0))
	restored = state.actions.ProcessAt(0)
	*state.loop.Queue() = scheduler.NewGenericHeap(2)
	state.currentEventCommands, state.budget.MaxCommandsPerEvent = 0, 1000
	if err := state.enqueueProcessTimer(restored); err != nil {
		test.Fatal(err)
	}
	event, _ := state.loop.Queue().Pop()
	if err := state.handleProcessTimer(event); err != nil || state.combatantHp("source") != 470 || state.actions.ManualAt(0).Uses().StepExecutedCount != 1 || restored.Status() != "complete" {
		test.Fatal("restoration repeated committed execution instead of completing", state.combatantHp("source"), restored, err)
	}
}
