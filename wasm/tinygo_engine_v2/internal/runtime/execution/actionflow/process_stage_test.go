package actionflow

import (
	"reflect"
	"testing"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

type processStageFixture struct {
	original         *actionpkg.ProcessView
	changes          *actionpkg.ProcessChangeSet
	publish          bool
	failureAt        string
	failure          *model.EngineError
	order            []string
	amounts          map[formula.GenericProgramID]float64
	cast             uint64
	castRef, use     string
	countCast, timer bool
	recastExecution  bool
	currentMoment    string
	finishObserved   bool
}

type recastStagesFixture struct {
	executor         ProcessExecutor
	acceptance, load *processStageFixture
	now              int64
}

func (f *recastStagesFixture) RejectRecast(model.DriverEntry, string) *model.EngineError {
	return nil
}
func (f *recastStagesFixture) RecastUseExists(string) bool { return false }
func (f *recastStagesFixture) CommitRecastAcceptance(process *actionpkg.ProcessView, ability planbundle.CompiledAbility, ref, use string, advance int64) (ActionResult, *model.EngineError) {
	return f.executor.ExecuteRecastAcceptance(process, f.acceptance.changes, ability, ref, use, advance, f.now, f.acceptance)
}
func (f *recastStagesFixture) CommitRecastExecution(process *actionpkg.ProcessView) *model.EngineError {
	// 本替身也在开始派发完成后才创建负载暂存，防止测试偶然认可旧快照。
	f.load.changes = actionpkg.StageProcess(process)
	return f.executor.ExecuteRecastExecution(process, f.load.changes, f.now, nil, f.load)
}

func (f *processStageFixture) SetProcessMoment(kind string, _ bool) {
	f.currentMoment = kind
	f.order = append(f.order, "moment:"+kind)
}
func (f *processStageFixture) ProcessAmount(program formula.GenericProgramID) (float64, *model.EngineError) {
	return f.amounts[program], nil
}
func (f *processStageFixture) ProcessCooldownFactor(*actionpkg.ProcessView) (float64, *model.EngineError) {
	return 1, nil
}
func (f *processStageFixture) ProcessFormulaError(_ formula.GenericProgramID, message string) *model.EngineError {
	err := model.NewEngineError(model.GenericPhaseRun, model.GenericErrFormulaTypeError, message)
	return &err
}
func (f *processStageFixture) StageProcessCooldown(*actionpkg.ProcessView, int64) *model.EngineError {
	return nil
}
func (f *processStageFixture) RecordProcessMoment(_ *actionpkg.ProcessView, kind string) {
	f.order = append(f.order, "record:"+kind)
}
func (f *processStageFixture) ResetProcessOutputs() {}
func (f *processStageFixture) IsProcessAttackReset(*actionpkg.ProcessView, string, planbundle.CompiledOperation) bool {
	return false
}
func (f *processStageFixture) ExecuteProcessOperations(planbundle.CompiledAbility, []planbundle.CompiledOperation) *model.EngineError {
	if f.failureAt == "operations" {
		return f.failure
	}
	return nil
}
func (f *processStageFixture) CaptureEmpoweredMoment(_ *actionpkg.ProcessView, kind string) {
	f.order = append(f.order, "capture:"+kind)
}
func (f *processStageFixture) SetProcessTimer(pending bool) { f.timer = pending }
func (f *processStageFixture) BindProcessCast(ref string, count bool) {
	f.castRef, f.countCast = ref, count
}
func (f *processStageFixture) NextProcessCast() uint64 { return f.cast }
func (f *processStageFixture) BindRecastUse(ref, _ string, use string, cast uint64) {
	f.castRef, f.use, f.cast = ref, use, cast
}
func (f *processStageFixture) SetRecastExecution() { f.recastExecution = true }
func (f *processStageFixture) RecordProcessUse(_ *actionpkg.ProcessView, kind string) {
	f.order = append(f.order, "use:"+kind)
}
func (f *processStageFixture) CommitProcessStage() (bool, *model.EngineError) {
	f.order = append(f.order, "commit")
	if f.publish {
		f.changes.Publish(f.original)
	}
	if f.failureAt == "commit" {
		return f.publish, f.failure
	}
	return f.publish, nil
}
func (f *processStageFixture) ObserveProcessFinish() {
	f.finishObserved = true
	f.order = append(f.order, "finish")
}
func (f *processStageFixture) ResolveProcessHits(kind string) *model.EngineError {
	f.order = append(f.order, "hits:"+kind)
	if f.failureAt == "hits" {
		return f.failure
	}
	return nil
}
func (f *processStageFixture) DispatchProcessStarted(planbundle.CompiledAbility) *model.EngineError {
	f.order = append(f.order, "started")
	if f.failureAt == "started" {
		return f.failure
	}
	return nil
}

func TestExecuteMomentOwnsStepPreparationAndTimer(t *testing.T) {
	step := planbundle.CompiledProcessStep{StepKey: "wait", StepType: "DELAY", DelayProgram: 0}
	state, process := processFixture(step)
	executor := NewProcessExecutor(&state, Identity{})
	changes := actionpkg.StageProcess(process)
	work := &processStageFixture{original: process, changes: changes, publish: true, amounts: map[formula.GenericProgramID]float64{0: 25}}
	result, err := executor.ExecuteMoment(process, changes, ProcessMoment{kind: "STEP_START", enterStep: true, stepIndex: 0}, 100, nil, work)
	if err != nil || result.Accepted || !work.timer || process.StepIndex() != 0 || process.StepKey() != "wait" || process.Expiry() != 125 || process.StepVersion() != 1 {
		t.Fatal("complete moment did not own the real step transition and timer", result, err, work.timer, process.Snapshot())
	}
	if !reflect.DeepEqual(work.order, []string{"moment:STEP_START", "record:STEP_START", "capture:STEP_START", "commit"}) {
		t.Fatal("step preparation changed the original moment order", work.order)
	}
}

func TestExecuteFinishPreservesPublishedPrefixAndObservationOrder(t *testing.T) {
	for _, test := range []struct {
		name, failureAt string
		publish         bool
	}{
		{"before commit", "commit", false},
		{"commit tail failure", "commit", true},
		{"hit tail failure", "hits", true},
		{"success", "", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			state, process := processFixture()
			executor := NewProcessExecutor(&state, Identity{})
			changes := actionpkg.StageProcess(process)
			failure := model.NewEngineError(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "stage failure")
			work := &processStageFixture{original: process, changes: changes, publish: test.publish, failureAt: test.failureAt, failure: &failure}
			result, err := executor.ExecuteMoment(process, changes, ProcessMoment{kind: "PROCESS_FAILURE", reason: "EVENT_ABORTED", finishStatus: "failed", castRef: "control", resolveHits: true}, 100, nil, work)
			if result.Accepted != test.publish || work.finishObserved != test.publish || work.countCast != true || work.castRef != "control" {
				t.Fatal("finish lost its current commit result or observed an uncommitted finish", result, work)
			}
			if test.failureAt != "" && err != &failure || test.failureAt == "" && err != nil {
				t.Fatal("finish replaced the original stage error", err)
			}
			wantStatus := "active"
			wantOrder := []string{"moment:PROCESS_FAILURE", "record:PROCESS_FAILURE", "capture:PROCESS_FAILURE", "commit"}
			if test.publish {
				wantStatus = "failed"
				wantOrder = append(wantOrder, "finish")
			}
			if test.failureAt != "commit" {
				wantOrder = append(wantOrder, "hits:PROCESS_FAILURE")
			}
			if process.Status() != wantStatus || !reflect.DeepEqual(work.order, wantOrder) {
				t.Fatal("finish changed the committed state or finish-before-error boundary", process.Status(), work.order, wantOrder)
			}
		})
	}
}

func TestTimerFinishDoesNotBecomeAnotherAcceptedAction(t *testing.T) {
	state, process := processFixture()
	changes := actionpkg.StageProcess(process)
	work := &processStageFixture{original: process, changes: changes, publish: true}
	result, err := NewProcessExecutor(&state, Identity{}).ExecuteMoment(process, changes, ProcessMoment{kind: "PROCESS_COMPLETE", finishStatus: "complete", resolveHits: true}, 100, nil, work)
	if err != nil || result.Accepted || process.Status() != "complete" || work.countCast || !work.finishObserved {
		t.Fatal("ordinary process termination invented another control action", result, err, process.Status(), work)
	}
}

func TestRecastStagesKeepAcceptedIdentityWithoutDoubleExecution(t *testing.T) {
	step := planbundle.CompiledProcessStep{StepKey: "again", StepType: "RECAST", MaximumRecastCount: 2}
	state, process := processFixture(step)
	entered := actionpkg.StageProcess(process)
	entered.EnterStep(0, step, 50)
	entered.Publish(process)
	executor := NewProcessExecutor(&state, Identity{})
	changes := actionpkg.StageProcess(process)
	work := &processStageFixture{original: process, changes: changes, publish: true, cast: 7}
	result, err := executor.ExecuteRecastAcceptance(process, changes, planbundle.CompiledAbility{CastOrigin: "manual"}, "recast", "recast:use:1", 125, 100, work)
	if err != nil || !result.Accepted || process.StepExecutionIndex() != 1 || process.CastID() != 7 || process.CastUseKey() != "recast:use:1" || process.AdvanceAtMs() != 125 || !work.timer {
		t.Fatal("recast acceptance did not preserve the current real identity", result, err, process.Snapshot(), work)
	}
	if !reflect.DeepEqual(work.order, []string{"moment:STEP_EXECUTION", "use:RECAST", "commit", "started"}) {
		t.Fatal("recast started before its acceptance commit", work.order)
	}
	// 负载仍借用开始监听之后创建的另一暂存，不能复用接纳帧。
	loadChanges := actionpkg.StageProcess(process)
	load := &processStageFixture{original: process, changes: loadChanges, publish: true}
	if err := executor.ExecuteRecastExecution(process, loadChanges, 100, nil, load); err != nil || !load.recastExecution || process.StepExecutionIndex() != 1 || process.CastID() != 7 || load.currentMoment != "" {
		t.Fatal("recast load counted again or kept the acceptance moment for commit", err, process.Snapshot(), load)
	}
	if !reflect.DeepEqual(load.order, []string{"moment:STEP_EXECUTION", "record:STEP_EXECUTION", "capture:STEP_EXECUTION", "moment:", "commit", "hits:STEP_EXECUTION"}) {
		t.Fatal("recast load lost its original moment clearing and hit order", load.order)
	}
}

func TestChargeReleaseKeepsAcceptedPrefixWhenHitsFail(t *testing.T) {
	step := planbundle.CompiledProcessStep{StepKey: "charge", StepType: "CHARGE"}
	state, process := processFixture(step)
	entered := actionpkg.StageProcess(process)
	entered.EnterStep(0, step, 50)
	entered.SetCast(9, "use")
	entered.Publish(process)
	changes := actionpkg.StageProcess(process)
	failure := model.NewEngineError(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "nested hit failure")
	work := &processStageFixture{original: process, changes: changes, publish: true, failureAt: "hits", failure: &failure}
	phases := &observedProcessPhases{now: 100}
	result, err := NewProcessExecutor(&state, Identity{}).ExecuteChargeRelease(process, changes, "release", 100, nil, work, phases)
	if err != &failure || !result.Accepted || process.StepExecutionIndex() != 1 || process.CastID() != 9 || process.HasStepCompletion() || len(phases.moments) != 0 {
		t.Fatal("failed charge hit lost acceptance, minted another cast or advanced later steps", result, err, process.Snapshot(), phases.moments)
	}
}

func TestAcceptRecastKeepsAcceptanceAcrossSeparateFrameFailures(t *testing.T) {
	for _, test := range []struct {
		name, acceptanceFailure, loadFailure string
		publish, accepted                    bool
	}{
		{"acceptance preflight", "commit", "", false, false},
		{"acceptance tail", "commit", "", true, true},
		{"started tail", "started", "", true, true},
		{"load preflight", "", "commit", true, true},
		{"load hits", "", "hits", true, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			step := planbundle.CompiledProcessStep{StepKey: "again", StepType: "RECAST", MaximumRecastCount: 2, RecastIntervalMs: 25}
			state, process := processFixture(step)
			entered := actionpkg.StageProcess(process)
			entered.EnterStep(0, step, 50)
			entered.Publish(process)
			executor := NewProcessExecutor(&state, Identity{})
			failure := model.NewEngineError(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "separate frame failure")
			acceptance := &processStageFixture{original: process, changes: actionpkg.StageProcess(process), cast: 7, publish: test.publish, failureAt: test.acceptanceFailure, failure: &failure}
			load := &processStageFixture{original: process, publish: test.loadFailure != "commit", failureAt: test.loadFailure, failure: &failure}
			stages := &recastStagesFixture{executor: executor, acceptance: acceptance, load: load, now: 100}
			result, err := executor.AcceptRecast(model.DriverEntry{}, process, planbundle.CompiledAbility{}, "recast", 100, stages, &observedProcessPhases{now: 100})
			if result.Accepted != test.accepted || err != &failure {
				t.Fatal("recast lost the acceptance frame's result when a later phase failed", result, err)
			}
			if test.publish && (process.StepExecutionIndex() != 1 || process.CastID() != 7 || process.CastUseKey() != "recast:use:1") {
				t.Fatal("separate frame failure removed accepted identity or double-counted execution", process.Snapshot(), process.CastID())
			}
			if !test.publish && process.StepExecutionIndex() != 0 {
				t.Fatal("uncommitted acceptance leaked into the actual process", process.Snapshot())
			}
		})
	}
}
