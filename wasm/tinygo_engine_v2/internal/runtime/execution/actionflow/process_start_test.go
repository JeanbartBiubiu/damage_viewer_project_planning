package actionflow

import (
	"reflect"
	"testing"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

type processStartFixture struct {
	process                  *actionpkg.ProcessView
	changes                  *actionpkg.ProcessChangeSet
	costs                    *processCostFixture
	condition, ammo, publish bool
	failureAt, interruptAt   string
	failure                  *model.EngineError
	order                    []string
	castCalls                int
	castBeforePayment        bool
}

func (f *processStartFixture) StartCondition(int) (bool, *model.EngineError) {
	f.order = append(f.order, "condition")
	return f.condition, nil
}
func (f *processStartFixture) StartAmmo() (bool, *model.EngineError) {
	f.order = append(f.order, "ammo")
	return f.ammo, nil
}
func (f *processStartFixture) StartCosts() ProcessCosts { return f.costs }
func (f *processStartFixture) NextStartCast() uint64 {
	f.order = append(f.order, "cast")
	f.castCalls++
	f.castBeforePayment = f.costs.current != 7
	return 12
}
func (f *processStartFixture) PrepareAcceptedStart(*actionpkg.ProcessView) *model.EngineError {
	f.order = append(f.order, "prepare")
	if f.failureAt == "prepare" {
		return f.failure
	}
	return nil
}
func (f *processStartFixture) RunStartMoment() *model.EngineError {
	f.order = append(f.order, "moment")
	if f.failureAt == "moment" {
		return f.failure
	}
	return nil
}
func (f *processStartFixture) CommitStart() (ActionResult, *model.EngineError) {
	f.order = append(f.order, "commit")
	if f.publish {
		f.changes.Publish(f.process)
	}
	if f.interruptAt == "commit" {
		interrupted := actionpkg.StageProcess(f.process)
		interrupted.Finish("failed", "EVENT_ABORTED", 100)
		interrupted.Publish(f.process)
	}
	if f.failureAt == "commit" {
		return ActionResult{Accepted: f.publish}, f.failure
	}
	return ActionResult{Accepted: f.publish}, nil
}
func (f *processStartFixture) DispatchAcceptedStart() *model.EngineError {
	f.order = append(f.order, "started")
	if f.interruptAt == "started" {
		interrupted := actionpkg.StageProcess(f.process)
		interrupted.Finish("failed", "EVENT_ABORTED", 100)
		interrupted.Publish(f.process)
	}
	if f.failureAt == "started" {
		return f.failure
	}
	return nil
}
func (f *processStartFixture) RejectStart(_ model.DriverEntry, reason string) *model.EngineError {
	f.order = append(f.order, "reject:"+reason)
	return nil
}

func processStartCase() (ProcessExecutor, *actionpkg.ProcessView, *processStartFixture) {
	var state actionpkg.State
	executor := NewProcessExecutor(&state, Identity{})
	process := executor.InitialProcess(ProcessStartInput{Owner: "source", Target: "target", ProviderRef: "item", AbilityRef: "initial", Use: "use", Now: 100,
		Definition: &planbundle.CompiledProcess{Path: "processes[cast]", ProcessKey: "cast", SkillKey: "author:q", Costs: []planbundle.CompiledProcessCost{{ResourceKey: "mana", AmountProgram: 0, Path: "costs[0]"}}}})
	changes := actionpkg.StageProcess(process)
	work := &processStartFixture{process: process, changes: changes, condition: true, ammo: true, publish: true,
		costs: &processCostFixture{current: 10, present: true, amounts: []float64{3}}}
	return executor, process, work
}

func TestStartPreparedRejectsBeforeAllocatingCastOrPublishingCosts(t *testing.T) {
	for _, reason := range []string{"condition_false", "ammo_empty", "resource_insufficient"} {
		t.Run(reason, func(t *testing.T) {
			executor, process, work := processStartCase()
			switch reason {
			case "condition_false":
				work.condition = false
			case "ammo_empty":
				work.ammo = false
			case "resource_insufficient":
				work.costs.current = 2
			}
			phases := &observedProcessPhases{now: 100}
			result, err := executor.StartPrepared(model.DriverEntry{}, 0, process, work.changes, nil, 100, work, phases)
			if err != nil || result.Accepted || result.Reason != reason || work.castCalls != 0 || process.CastID() != 0 || process.Costs().Len() != 0 || len(phases.moments) != 0 {
				t.Fatal("normal start rejection allocated a cast or published partial costs", result, err, work, process.Snapshot())
			}
		})
	}
}

func TestStartPreparedKeepsCurrentAcceptanceAcrossInterruptionsAndTailFailure(t *testing.T) {
	for _, test := range []struct {
		name, failureAt, interruptAt string
		publish, accepted            bool
	}{
		{"prepare failure", "prepare", "", false, false},
		{"start moment failure", "moment", "", false, false},
		{"commit preflight failure", "commit", "", false, false},
		{"commit tail failure", "commit", "", true, true},
		{"commit interrupted", "", "commit", true, true},
		{"started interrupted", "", "started", true, true},
		{"started tail failure", "started", "", true, true},
		{"later step failure", "step", "", true, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			executor, process, work := processStartCase()
			failure := model.NewEngineError(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "start tail failure")
			work.publish, work.failureAt, work.interruptAt, work.failure = test.publish, test.failureAt, test.interruptAt, &failure
			phases := &observedProcessPhases{now: 100}
			if test.failureAt == "step" {
				phases.failureAt, phases.failure = "PROCESS_COMPLETE", &failure
			}
			result, err := executor.StartPrepared(model.DriverEntry{}, 0, process, work.changes, nil, 100, work, phases)
			if result.Accepted != test.accepted || work.castCalls != 1 || work.castBeforePayment {
				t.Fatal("start used readiness or cast allocation as acceptance", result, work)
			}
			if test.failureAt != "" && err != &failure || test.failureAt == "" && err != nil {
				t.Fatal("start lost the original preparation or tail error", result, err)
			}
			if test.publish {
				if process.CastID() != 12 || process.CastUseKey() != "use" || process.Costs().At("mana") != 3 {
					t.Fatal("accepted prefix lost its paid cost or cast identity", process.Snapshot(), process.CastID())
				}
			} else if process.CastID() != 0 || process.Costs().Len() != 0 {
				t.Fatal("uncommitted start changed the real process", process.Snapshot(), process.CastID())
			}
			if test.interruptAt != "" && (process.Status() != "failed" || len(phases.moments) != 0) {
				t.Fatal("start continued with stale active qualification after a synchronous interruption", process.Status(), phases.moments)
			}
			if !reflect.DeepEqual(work.costs.order, []string{"read", "resource", "pay"}) {
				t.Fatal("start changed the payment-before-cast boundary", work.costs.order)
			}
		})
	}
}

func TestInitialProcessOwnsDefaultsAndOptionalZeroBinding(t *testing.T) {
	var state actionpkg.State
	executor := NewProcessExecutor(&state, Identity{})
	definition := &planbundle.CompiledProcess{ProcessKey: "new", SkillKey: "author:q"}
	process := executor.InitialProcess(ProcessStartInput{Owner: "source", Target: "target", ProviderRef: "item", AbilityRef: "initial", Use: "use", Definition: definition, Now: 120,
		Empowered: &ProcessEmpoweredBinding{AbilityIndex: 0, ReplacesPrimary: true, Slot: 0}})
	if state.ProcessCount() != 0 || process.Status() != "active" || process.StepIndex() != -1 || process.StepVersion() != 0 || process.StepStartedAtMs() != 120 || process.AdvanceAtMs() != 120 || process.StartedAtMs() != 120 || process.CastID() != 0 || process.CastUseKey() != "use" {
		t.Fatal("initialization registered a process or exposed invalid default progress", process.Snapshot())
	}
	if !process.HasEmpoweredAbility() || process.EmpoweredAbilityIndex() != 0 || !process.ReplacesPrimary() || process.PrimaryReplacementBinding() != 0 || process.Costs().Len() != 0 || process.OccupancyCount() != 0 {
		t.Fatal("initialization dropped a valid zero binding or invented prior costs/occupancy", process.Snapshot())
	}
}
