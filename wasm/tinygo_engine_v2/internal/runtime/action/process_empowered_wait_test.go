package action

import (
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestEmpoweredWaitIndexRequiresBindingAndTracksCommit(t *testing.T) {
	var state State
	deadline := int64(1125)
	ordinary := NewProcess(ProcessSeed{Snapshot: model.ProcessInstanceSnapshot{
		Owner: "source", ProviderRef: "spell", ProcessKey: "delayed", UseKey: "ordinary",
		Status: "active", StepKey: "travel", ExpiresAtMs: &deadline,
	}})
	state.AddProcess(ordinary)
	state.UpdateEmpoweredWait(ordinary)
	if state.EmpoweredCount() != 0 {
		t.Fatal("ordinary delayed process entered the empowered wait index")
	}

	empowered := NewProcess(ProcessSeed{HasEmpoweredAbility: true, Snapshot: model.ProcessInstanceSnapshot{
		Owner: "source", ProviderRef: "spell", ProcessKey: "empowered", UseKey: "empowered",
		Status: "active", StepKey: "wait", ExpiresAtMs: &deadline,
	}})
	state.AddProcess(empowered)
	state.UpdateEmpoweredWait(empowered)
	state.UpdateEmpoweredWait(empowered)
	state.UpdateEmpoweredWait(ordinary)
	if state.EmpoweredCount() != 1 || state.EmpoweredAt(0) != empowered || !empowered.HasEmpoweredAbility() || empowered.EmpoweredAbilityIndex() != 0 {
		t.Fatal("committed empowered binding at index zero was lost or duplicated")
	}

	changes := StageProcess(empowered)
	changes.Finish("complete", "", 500)
	changes.Publish(empowered)
	state.UpdateEmpoweredWait(empowered)
	if state.EmpoweredCount() != 0 {
		t.Fatal("completed process remained in the empowered wait index")
	}
}
