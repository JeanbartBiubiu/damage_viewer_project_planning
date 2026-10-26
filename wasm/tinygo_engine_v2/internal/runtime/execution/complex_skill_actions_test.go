package execution

import (
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	scheduler "tinygo_engine_v2/internal/scheduler"
)

func complexSkillInput(kind string, occupies bool) (model.CompileRequest, model.RunRequest) {
	input, request := singleSkillInput(false)
	step := model.ProcessStepDefinition{StepKey: "complex", StepType: kind, OccupiesAction: &occupies}
	switch kind {
	case "MULTI_HIT":
		step.RepeatCount, step.IntervalMs = timedShieldExpr(4), timedShieldExpr(100)
	case "CHANNEL":
		first := "IMMEDIATE"
		step.DurationMs, step.ExecutionCount, step.FirstExecution = timedShieldExpr(1000), timedShieldExpr(4), &first
	case "CHARGE":
		step.MinimumChargeMs, step.MaximumChargeMs, step.ReleaseAtMaximum = timedShieldExpr(200), timedShieldExpr(800), model.BoolPtr(false)
	case "RECAST":
		step.WindowMs = timedShieldExpr(800)
		step.MaximumRecastCount = timedShieldExpr(1)
	}
	input.SharedProviders[0].Processes[0].Steps = []model.ProcessStepDefinition{step}
	input.Rules.SkillActionBindings[0].HitBindings[0].Moment = model.ProcessMomentDefinition{MomentType: "STEP_EXECUTION", StepKey: &step.StepKey}
	request.StopPolicy.DurationMs = 1200
	return input, request
}

func addComplexControl(input *model.CompileRequest, request *model.RunRequest, key, action string, at int64, order int) {
	binding := &input.Rules.SkillActionBindings[0]
	var provider *model.ProviderDefinition
	for index := range input.SharedProviders {
		if input.SharedProviders[index].ProviderKey == binding.ProviderDefinitionRef {
			provider = &input.SharedProviders[index]
		}
	}
	step := provider.Processes[0].Steps[0]
	control := &model.ProcessControlDefinition{Action: action, ProcessKey: "cast"}
	if action == "CANCEL" {
		control.FailureReason = "ACTIVE_CANCELLED"
	} else {
		control.StepKey = step.StepKey
	}
	abilityKey := "control_" + action
	ref := "source.provider[" + binding.ProviderRef + "].ability[" + abilityKey + "]"
	found := false
	for _, existing := range binding.Controls {
		found = found || existing.Action == action
	}
	if !found {
		provider.Abilities = append(provider.Abilities, model.AbilityDefinition{AbilityKey: abilityKey, Kind: "active", SkillKey: binding.SkillKey, ProcessControl: control})
		binding.Controls = append(binding.Controls, model.SkillActionControl{Action: action, ProcessKey: "cast", AbilityRef: ref})
	}
	parent := request.DriverPlan.SkillActions[0].InstructionKey
	request.DriverPlan.SkillActions = append(request.DriverPlan.SkillActions, model.SkillActionPlan{InstructionKey: key, FirstAtMs: at, SortOrder: order, Source: "source", Target: "target", SkillKey: binding.SkillKey, BindingKey: binding.BindingKey, Action: action, AbilityRef: ref, ParentInstructionKey: &parent, HitBindings: []model.SkillActionHitPreset{}})
}

func TestComplexSkillFiniteSegmentsAndFrozenTiming(test *testing.T) {
	for _, scenario := range []struct {
		kind  string
		first string
		times []int64
	}{{"MULTI_HIT", "", []int64{100, 200, 300, 400}}, {"CHANNEL", "IMMEDIATE", []int64{100, 350, 600, 850}}, {"CHANNEL", "AFTER_INTERVAL", []int64{350, 600, 850, 1100}}} {
		test.Run(scenario.kind+scenario.first, func(test *testing.T) {
			input, request := complexSkillInput(scenario.kind, true)
			if scenario.first != "" {
				input.SharedProviders[0].Processes[0].Steps[0].FirstExecution = &scenario.first
			}
			done := timedShieldMustRun(test, input, request)
			uses := done.Summary.SkillUses
			if uses.StartedCount != 1 || uses.ReleasedCount != 4 || uses.HitCount != 4 || uses.CompletedCount != 1 || uses.StepEnteredCount != 1 || uses.StepExecutedCount != 4 || uses.StepCompletedCount != 1 || done.Summary.AbilityCastCount != 1 || done.Summary.SourceDamageDealt != 400 {
				test.Fatal(done.Summary)
			}
			for index, record := range done.DamageRecords {
				if record["timeMs"] != scenario.times[index] || record["useRef"] != "skill:cast_once" || record["hitRef"] != "hit:"+itoa(uint32(index+1)) {
					test.Fatal(done.DamageRecords)
				}
			}
			process := done.FinalSnapshot.ProcessInstances[0]
			if process.Repeat.ExecutionIndex != 4 || process.Repeat.NextExecutionAtMs != nil || len(process.ActionOccupancies) != 1 || process.ActionOccupancies[0].FinishedAtMs == nil || *process.ActionOccupancies[0].FinishedAtMs != *process.FinishedAtMs {
				test.Fatal(process)
			}
		})
	}
}

func TestComplexSkillRepeatTransitionQueueFailureIsAtomic(test *testing.T) {
	input, request := complexSkillInput("MULTI_HIT", true)
	state := frameCommitState(test, input, request)
	state.loop.Advance(100)
	if err := state.handleSkillAction(0); err != nil {
		test.Fatal(err)
	}
	process := state.actions.ProcessAt(0)
	*state.loop.Queue() = scheduler.NewGenericHeap(1)
	state.loop.Queue().SetLimit(1)
	state.loop.Queue().Push(scheduler.GenericEvent{TimeMs: 1000})
	state.loop.Advance(200)
	if err := state.executeProcessRepeat(process); err == nil || err.BudgetCause != model.BudgetCauseMaxQueueEvents {
		test.Fatal(err)
	}
	if process.Repeat().ExecutionIndex != 1 || *process.Repeat().NextExecutionAtMs != 200 || process.StepExecutionIndex() != 1 || state.combatantHp("target") != 400 || state.actions.ManualAt(0).Uses().ReleasedCount != 1 || state.actions.ManualAt(0).Uses().StepExecutedCount != 1 || len(process.ActionOccupancies()) != 1 || process.ActionOccupancies()[0].FinishedAtMs != nil {
		test.Fatal(process, state.actions.ManualAt(0).Uses())
	}
}

func TestComplexSkillRepeatedSourceDeathAndOldTimerCannotRelease(test *testing.T) {
	input, request := complexSkillInput("MULTI_HIT", true)
	hp := input.Combatants[0].Attributes["hp"]
	hp.Current = 250
	input.Combatants[0].Attributes["hp"] = hp
	request.InitialSnapshot.Combatants[0].Attributes["hp"] = hp
	step := "complex"
	input.SharedProviders[0].Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "STEP_EXECUTION", StepKey: &step}, Operations: []model.OperationDefinition{{Operation: "damage", Target: "self", Amount: timedShieldExpr(100), DamageType: "damage/physical"}}}}
	done := timedShieldMustRun(test, input, request)
	if done.Summary.SourceFinalHp != 0 || done.Summary.SkillUses.FailedCount != 1 || done.Summary.SkillUses.HitCount != 2 || done.Summary.SkillUses.StepExecutedCount != 3 || *done.FinalSnapshot.ProcessInstances[0].FailureReason != "SOURCE_DIED" || *done.FinalSnapshot.ProcessInstances[0].ActionOccupancies[0].FinishedAtMs != 300 {
		test.Fatal(done.Summary, done.SkillUseRecords)
	}
	input, request = complexSkillInput("MULTI_HIT", true)
	state := frameCommitState(test, input, request)
	state.loop.Advance(100)
	if err := state.handleSkillAction(0); err != nil {
		test.Fatal(err)
	}
	if err := state.handleProcessTimer(scheduler.GenericEvent{TimeMs: 100, ProcessIndex: 0, ProcessStepVersion: 1, ProcessExecutionIndex: 0}); err != nil || state.actions.ManualAt(0).Uses().HitCount != 1 {
		test.Fatal("stale execution timer altered the next segment", err)
	}
}

func TestComplexSkillRestorationRejectsChangedFrozenProgress(test *testing.T) {
	input, request := complexSkillInput("MULTI_HIT", true)
	request.StopPolicy.DurationMs = 250
	done := timedShieldMustRun(test, input, request)
	state := frameCommitState(test, input, request)
	state.loop.Advance(250)
	row := done.FinalSnapshot.ProcessInstances[0]
	if _, err := state.restoreProcess(row, "snapshot"); err != nil {
		test.Fatal(err)
	}
	repeat := *row.Repeat
	repeat.ExecutionIndex++
	row.Repeat = &repeat
	if _, err := state.restoreProcess(row, "snapshot"); err == nil {
		test.Fatal("contradictory frozen segment progress restored")
	}
	next := int64(400)
	repeat.NextExecutionAtMs = &next
	row.StepExecutionIndex = 3
	last := int64(300)
	row.LastExecutionAtMs = &last
	if _, err := state.restoreProcess(row, "snapshot"); err == nil {
		test.Fatal("future segment was accepted as already committed")
	}
	row = done.FinalSnapshot.ProcessInstances[0]
	row.ActionOccupancies = []model.ProcessActionOccupancy{}
	if _, err := state.restoreProcess(row, "snapshot"); err == nil {
		test.Fatal("incomplete occupancy history restored")
	}
}

func TestComplexSkillCancelledRepeatClearsNextExecution(test *testing.T) {
	input, request := complexSkillInput("MULTI_HIT", true)
	addComplexControl(&input, &request, "cancel", "CANCEL", 150, 1)
	done := timedShieldMustRun(test, input, request)
	process := done.FinalSnapshot.ProcessInstances[0]
	if process.Status != "failed" || process.Repeat.ExecutionIndex != 1 || process.Repeat.NextExecutionAtMs != nil || done.Summary.SkillUses.HitCount != 1 || *process.ActionOccupancies[0].FinishedAtMs != 150 {
		test.Fatal(process, done.Summary)
	}
	state := frameCommitState(test, input, request)
	state.loop.Advance(done.FinalSnapshot.TimeMs)
	if _, err := state.restoreProcess(process, "snapshot"); err != nil {
		test.Fatal("terminated frozen progress did not restore", err)
	}
	forbidden := int64(200)
	repeat := *process.Repeat
	repeat.NextExecutionAtMs = &forbidden
	process.Repeat = &repeat
	if _, err := state.restoreProcess(process, "snapshot"); err == nil {
		test.Fatal("cancelled process restored an executable next segment")
	}
}

func TestComplexSkillRestoreCommittedPrefixDoesNotExecuteAgain(test *testing.T) {
	input, request := complexSkillInput("CHANNEL", true)
	first := "AFTER_INTERVAL"
	channel := input.SharedProviders[0].Processes[0].Steps[0]
	channel.FirstExecution = &first
	prefix := model.ProcessStepDefinition{StepKey: "prefix", StepType: "DELAY", OccupiesAction: model.BoolPtr(true), DelayMs: timedShieldExpr(100)}
	input.SharedProviders[0].Processes[0].Steps = []model.ProcessStepDefinition{prefix, channel}
	input.SharedProviders[0].Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "STEP_EXECUTION", StepKey: &prefix.StepKey}, Operations: []model.OperationDefinition{{Operation: "damage", Target: "self", Amount: timedShieldExpr(10), DamageType: "damage/physical"}}}}
	state := frameCommitState(test, input, request)
	state.loop.Advance(100)
	if err := state.handleSkillAction(0); err != nil {
		test.Fatal(err)
	}
	*state.loop.Queue() = scheduler.NewGenericHeap(1)
	state.loop.Queue().SetLimit(1)
	state.loop.Queue().Push(scheduler.GenericEvent{TimeMs: 1000})
	state.loop.Advance(200)
	if err := state.handleProcessTimer(scheduler.GenericEvent{TimeMs: 200, ProcessIndex: 0, ProcessStepVersion: 1}); err == nil || err.BudgetCause != model.BudgetCauseMaxQueueEvents {
		test.Fatal(err)
	}
	if state.combatantHp("source") != 490 || state.actions.ManualAt(0).Uses().StepCompletedCount != 1 {
		test.Fatal("prefix was not committed once", state.combatantHp("source"))
	}
	row := state.snapshotProcesses()[0]
	restored, err := state.restoreProcess(row, "snapshot")
	if err != nil {
		test.Fatal(err)
	}
	actionpkg.StageProcess(restored).Publish(state.actions.ProcessAt(0))
	restored = state.actions.ProcessAt(0)
	*state.loop.Queue() = scheduler.NewGenericHeap(10)
	if err := state.enqueueProcessTimer(restored); err != nil {
		test.Fatal(err)
	}
	event, _ := state.loop.Queue().Pop()
	if err := state.handleProcessTimer(event); err != nil {
		test.Fatal(err)
	}
	if state.combatantHp("source") != 490 || state.actions.ManualAt(0).Uses().StepExecutedCount != 1 || state.actions.ManualAt(0).Uses().StepCompletedCount != 1 || state.actions.ProcessAt(0).StepVersion() != 2 {
		test.Fatal("restoration replayed an already committed prefix", state.combatantHp("source"), state.actions.ManualAt(0).Uses())
	}
}

func TestComplexSkillRestoreExecutionOnlyCommitsUnfinishedCompletion(test *testing.T) {
	input, request := singleSkillInput(false)
	step := "delay"
	input.SharedProviders[0].Processes[0].MomentOperations = []model.ProcessMomentOperations{
		{Moment: model.ProcessMomentDefinition{MomentType: "STEP_EXECUTION", StepKey: &step}, Operations: []model.OperationDefinition{{Operation: "damage", Target: "self", Amount: timedShieldExpr(10), DamageType: "damage/physical"}}},
		{Moment: model.ProcessMomentDefinition{MomentType: "STEP_COMPLETE", StepKey: &step}, Operations: []model.OperationDefinition{{Operation: "damage", Target: "self", Amount: timedShieldExpr(20), DamageType: "damage/physical"}}},
	}
	state := frameCommitState(test, input, request)
	state.loop.Advance(100)
	if err := state.handleSkillAction(0); err != nil {
		test.Fatal(err)
	}
	state.loop.Advance(350)
	state.currentEventCommands, state.budget.MaxCommandsPerEvent = 0, 1
	process := state.actions.ProcessAt(0)
	if err := state.runProcessMoment(process, "STEP_EXECUTION", ""); err != nil {
		test.Fatal(err)
	}
	if err := state.completeProcessStep(process); err == nil || err.BudgetCause != model.BudgetCauseMaxCommandsPerEvent {
		test.Fatal(err)
	}
	row := state.snapshotProcesses()[0]
	if row.StepExecutionIndex != 1 || *row.LastExecutionAtMs != 350 || row.StepCompletedAtMs != nil || state.combatantHp("source") != 490 {
		test.Fatal(row)
	}
	restored, err := state.restoreProcess(row, "snapshot")
	if err != nil {
		test.Fatal(err)
	}
	actionpkg.StageProcess(restored).Publish(state.actions.ProcessAt(0))
	restored = state.actions.ProcessAt(0)
	state.currentEventCommands, state.budget.MaxCommandsPerEvent = 0, 1000
	*state.loop.Queue() = scheduler.NewGenericHeap(10)
	state.enqueueProcessTimer(restored)
	event, _ := state.loop.Queue().Pop()
	if err := state.handleProcessTimer(event); err != nil {
		test.Fatal(err)
	}
	if state.combatantHp("source") != 470 || state.actions.ManualAt(0).Uses().StepExecutedCount != 1 || state.actions.ManualAt(0).Uses().StepCompletedCount != 1 {
		test.Fatal("restoration replayed execution before completing", state.combatantHp("source"), state.actions.ManualAt(0).Uses())
	}
}

func TestComplexSkillRestoreBeforeFirstStepDoesNotStartAgain(test *testing.T) {
	input, request := complexSkillInput("CHARGE", true)
	state := frameCommitState(test, input, request)
	state.loop.Advance(100)
	*state.loop.Queue() = scheduler.NewGenericHeap(1)
	state.loop.Queue().SetLimit(1)
	state.loop.Queue().Push(scheduler.GenericEvent{TimeMs: 1000})
	if err := state.handleSkillAction(0); err == nil || err.BudgetCause != model.BudgetCauseMaxQueueEvents {
		test.Fatal(err)
	}
	row := state.snapshotProcesses()[0]
	if row.StepVersion != 0 || row.StepExecutionIndex != 0 || row.LastExecutionAtMs != nil || row.StepCompletedAtMs != nil {
		test.Fatal(row)
	}
	restored, err := state.restoreProcess(row, "snapshot")
	if err != nil {
		test.Fatal(err)
	}
	actionpkg.StageProcess(restored).Publish(state.actions.ProcessAt(0))
	restored = state.actions.ProcessAt(0)
	*state.loop.Queue() = scheduler.NewGenericHeap(10)
	state.enqueueProcessTimer(restored)
	event, _ := state.loop.Queue().Pop()
	if err := state.handleProcessTimer(event); err != nil {
		test.Fatal(err)
	}
	if state.actions.ProcessAt(0).StepVersion() != 1 || state.actions.ManualAt(0).Uses().StartedCount != 1 || state.abilityCastCount != 1 || processCount(state.buildDoneResult(false), "process_moment", "PROCESS_START") != 1 {
		test.Fatal("restoration repeated the committed initial start", state.actions.ManualAt(0).Uses())
	}
}

func TestComplexSkillFailedProgressRequiresExactCooldownMarker(test *testing.T) {
	for _, moment := range []string{"STEP_EXECUTION", "STEP_COMPLETE"} {
		input, request := complexSkillInput("MULTI_HIT", true)
		step := "complex"
		input.SharedProviders[0].Processes[0].Cooldown.StartMoment = model.ProcessMomentDefinition{MomentType: moment, StepKey: &step}
		hp := input.Combatants[0].Attributes["hp"]
		hp.Current = 250
		input.Combatants[0].Attributes["hp"] = hp
		request.InitialSnapshot.Combatants[0].Attributes["hp"] = hp
		input.SharedProviders[0].Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "STEP_EXECUTION", StepKey: &step}, Operations: []model.OperationDefinition{{Operation: "damage", Target: "self", Amount: timedShieldExpr(100), DamageType: "damage/physical"}}}}
		done := timedShieldMustRun(test, input, request)
		row := done.FinalSnapshot.ProcessInstances[0]
		state := frameCommitState(test, input, request)
		state.loop.Advance(done.FinalSnapshot.TimeMs)
		if _, err := state.restoreProcess(row, "snapshot"); err != nil {
			test.Fatal(moment, err)
		}
		row.CooldownStarted = !row.CooldownStarted
		if _, err := state.restoreProcess(row, "snapshot"); err == nil {
			test.Fatal(moment, "failed step restored a contradictory cooldown marker")
		}
	}
}
