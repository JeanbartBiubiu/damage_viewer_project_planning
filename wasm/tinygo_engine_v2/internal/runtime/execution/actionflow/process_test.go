package actionflow

import (
	"reflect"
	"testing"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

type observedProcessPhases struct {
	now         int64
	moments     []string
	interruptAt string
	failureAt   string
	failure     *model.EngineError
}

type processAmountsFixture struct {
	values map[formula.GenericProgramID]float64
	reads  []formula.GenericProgramID
}

func (phases *observedProcessPhases) CommitProcessMoment(process *actionpkg.ProcessView, moment ProcessMoment) *model.EngineError {
	phases.moments = append(phases.moments, moment.Kind)
	changes := actionpkg.StageProcess(process)
	if moment.EnterStep {
		changes.EnterStep(moment.StepIndex, process.Definition().Steps[moment.StepIndex], phases.now)
	}
	if moment.Kind == "STEP_EXECUTION" {
		changes.ExecuteStep(phases.now, false)
	}
	if moment.Kind == "STEP_COMPLETE" {
		changes.CompleteStep(phases.now)
	}
	if moment.FinishStatus != "" {
		changes.Finish(moment.FinishStatus, moment.Reason, phases.now)
	}
	if moment.Kind == phases.interruptAt {
		changes.Finish("failed", "EVENT_ABORTED", phases.now)
	}
	changes.Publish(process)
	if moment.Kind == phases.failureAt {
		return phases.failure
	}
	return nil
}

func (phases *observedProcessPhases) PublishProcessResolved(*actionpkg.ProcessView) *model.EngineError {
	phases.moments = append(phases.moments, "RESOLVED")
	return nil
}

func (phases *observedProcessPhases) FinishEmpoweredWindow(*actionpkg.ProcessView) *model.EngineError {
	phases.moments = append(phases.moments, "EMPOWERED_WINDOW")
	return nil
}

func (amounts *processAmountsFixture) ProcessAmount(program formula.GenericProgramID) (float64, *model.EngineError) {
	amounts.reads = append(amounts.reads, program)
	return amounts.values[program], nil
}

func processFixture(steps ...planbundle.CompiledProcessStep) (actionpkg.State, *actionpkg.ProcessView) {
	var state actionpkg.State
	process := actionpkg.NewProcess(actionpkg.ProcessSeed{
		Snapshot:   model.ProcessInstanceSnapshot{Owner: "source", ProviderRef: "item", ProcessKey: "cast", SkillKey: "author:q", UseKey: "use", Target: "target", Status: "active"},
		Definition: &planbundle.CompiledProcess{Path: "processes[cast]", ProcessKey: "cast", SkillKey: "author:q", Steps: steps},
		StepIndex:  -1,
	})
	state.AddProcess(process)
	return state, process
}

func TestImmediateStepsRecheckCommittedQualification(t *testing.T) {
	for _, interrupt := range []string{"", "STEP_START", "STEP_EXECUTION", "STEP_COMPLETE"} {
		t.Run(interrupt, func(t *testing.T) {
			state, process := processFixture(planbundle.CompiledProcessStep{StepKey: "first", StepType: "IMMEDIATE"}, planbundle.CompiledProcessStep{StepKey: "second", StepType: "IMMEDIATE"})
			executor := NewProcessExecutor(&state, Identity{})
			phases := &observedProcessPhases{now: 100, interruptAt: interrupt}
			if err := executor.EnterStep(process, 0, 100, phases); err != nil {
				t.Fatal(err)
			}
			want := []string{"STEP_START", "STEP_EXECUTION", "STEP_COMPLETE", "STEP_START", "STEP_EXECUTION", "STEP_COMPLETE", "PROCESS_COMPLETE", "RESOLVED"}
			switch interrupt {
			case "STEP_START":
				want = want[:1]
			case "STEP_EXECUTION":
				want = want[:2]
			case "STEP_COMPLETE":
				want = want[:3]
			}
			if !reflect.DeepEqual(phases.moments, want) {
				t.Fatal("committed interruption did not stop the next real phase", phases.moments, want)
			}
			if interrupt == "" && process.Status() != "complete" || interrupt != "" && process.Status() != "failed" {
				t.Fatal("actual process status was replaced by a local prediction", process.Status())
			}
		})
	}
}

func TestCommittedFinishFailureDoesNotPublishResolved(t *testing.T) {
	state, process := processFixture()
	executor := NewProcessExecutor(&state, Identity{})
	failure := model.NewEngineError(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "derived failure")
	phases := &observedProcessPhases{failureAt: "PROCESS_COMPLETE", failure: &failure}
	if err := executor.Finish(process, "complete", "", "", phases); err != &failure {
		t.Fatal("committed derived failure lost its original error", err)
	}
	if process.Status() != "complete" || !reflect.DeepEqual(phases.moments, []string{"PROCESS_COMPLETE"}) {
		t.Fatal("derived failure rolled back committed state or invented a resolved fact", process.Status(), phases.moments)
	}
}

func TestTimerKeepsSlotZeroAndRejectsStaleCompleteIdentity(t *testing.T) {
	state, process := processFixture(planbundle.CompiledProcessStep{StepKey: "first", StepType: "IMMEDIATE"})
	executor := NewProcessExecutor(&state, Identity{SchemaHash: "schema", RulesHash: "rules", SessionID: "session"})
	for _, timer := range []ProcessTimer{{Index: 0, StepVersion: 1}, {Index: 0, ExecutionIndex: 1}} {
		phases := &observedProcessPhases{}
		if err := executor.HandleTimer(timer, 0, phases); err != nil || len(phases.moments) != 0 || process.StepVersion() != 0 {
			t.Fatal("stale timer changed the original process", timer, err, phases.moments)
		}
	}
	phases := &observedProcessPhases{}
	if err := executor.HandleTimer(ProcessTimer{Index: 0}, 0, phases); err != nil || process.Status() != "complete" {
		t.Fatal("zero slot or version was treated as missing", err, process.Status())
	}
	err := executor.HandleTimer(ProcessTimer{Index: -1}, 0, phases)
	if err == nil || err.Path != "processInstances" || err.Message != "unknown process timer instance" || err.SchemaHash != "schema" || err.RulesHash != "rules" || err.SessionID != "session" {
		t.Fatal("invalid timer slot lost its original error", err)
	}
}

func TestRepeatReadOrderAndFrozenCompleteWindow(t *testing.T) {
	step := planbundle.CompiledProcessStep{Path: "steps[channel]", StepKey: "channel", StepType: "CHANNEL", FirstExecution: "CUSTOM_WINDOW",
		ExecutionCountProgram: 0, DurationProgram: 1, FirstExecutionOffsetProgram: 2, LastExecutionOffsetProgram: 3}
	state, process := processFixture(step)
	executor := NewProcessExecutor(&state, Identity{})
	amounts := &processAmountsFixture{values: map[formula.GenericProgramID]float64{0: 3, 1: 1000, 2: 0, 3: 700}}
	changes := actionpkg.StageProcess(process)
	timer, err := executor.PrepareStep(changes, 0, 50, amounts)
	pending := changes.View()
	if err != nil || timer || pending.Expiry() != 1050 || pending.NextExecutionAt() != 50 || pending.Repeat().FirstExecutionOffsetMs != 0 || pending.Repeat().LastExecutionOffsetMs != 700 {
		t.Fatal("custom window lost a valid zero offset or complete duration", err, timer, pending.Snapshot())
	}
	if !reflect.DeepEqual(amounts.reads, []formula.GenericProgramID{0, 1, 2, 3}) || process.StepVersion() != 0 {
		t.Fatal("preparation changed formula order or published original state", amounts.reads, process.Snapshot())
	}
	amounts.values[0], amounts.reads = 0, nil
	changes = actionpkg.StageProcess(process)
	_, err = executor.PrepareStep(changes, 0, 50, amounts)
	if err == nil || err.Message != "finite process execution count must be an integer in [1,64]" || !reflect.DeepEqual(amounts.reads, []formula.GenericProgramID{0}) {
		t.Fatal("invalid count evaluated later formulas or became a valid zero", err, amounts.reads)
	}
}
