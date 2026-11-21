package actionflow

import (
	"testing"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

type cascadingStunFixture struct {
	observedProcessPhases
	executor  ProcessExecutor
	deadlines map[string]int64
	settling  bool
	reentries int
}

func (f *cascadingStunFixture) ProcessStunUntil(owner string) (int64, *model.EngineError) {
	return f.deadlines[owner], nil
}
func (f *cascadingStunFixture) ProcessStunSettling() bool { return f.settling }
func (f *cascadingStunFixture) BeginProcessStun()         { f.settling = true }
func (f *cascadingStunFixture) EndProcessStun()           { f.settling = false }
func (f *cascadingStunFixture) CommitProcessMoment(process *actionpkg.ProcessView, moment ProcessMoment) (ActionResult, *model.EngineError) {
	result, err := f.observedProcessPhases.CommitProcessMoment(process, moment)
	if err != nil || moment.kind != "PROCESS_FAILURE" {
		return result, err
	}
	if process.Owner() == "target" {
		f.deadlines["source"] = 500
	}
	f.reentries++
	return result, f.executor.FailStunnedProcesses(f.now, f, f)
}

func TestStunFailureRechecksEarlierProcessesAndGuardsSynchronousReentry(t *testing.T) {
	state, first := processFixture(planbundle.CompiledProcessStep{StepKey: "charge", StepType: "CHARGE"})
	changes := actionpkg.StageProcess(first)
	changes.EnterStep(0, first.Definition().Steps[0], 100)
	changes.Publish(first)
	second := actionpkg.NewProcess(actionpkg.ProcessSeed{Snapshot: model.ProcessInstanceSnapshot{Owner: "target", ProviderRef: "item", ProcessKey: "cast", SkillKey: "author:q", UseKey: "later", Target: "source", Status: "active"}, Definition: first.Definition(), StepIndex: 0})
	state.AddProcess(second)
	executor := NewProcessExecutor(&state, Identity{})
	fixture := &cascadingStunFixture{observedProcessPhases: observedProcessPhases{now: 100}, executor: executor, deadlines: map[string]int64{"target": 500}}
	if err := executor.FailStunnedProcesses(100, fixture, fixture); err != nil {
		t.Fatal(err)
	}
	if first.Status() != "failed" || second.Status() != "failed" || fixture.settling || fixture.reentries != 2 {
		t.Fatal("synchronous control changes escaped or repeated failure", first.Status(), second.Status(), fixture.settling, fixture.reentries, fixture.moments)
	}
	failures := 0
	for _, moment := range fixture.moments {
		if moment == "PROCESS_FAILURE" {
			failures++
		}
	}
	if failures != 2 {
		t.Fatal("process failed more than once", fixture.moments)
	}
}
