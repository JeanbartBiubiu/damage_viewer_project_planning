package action

import (
	"testing"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func TestProcessChangesKeepPublishedAndFrozenSnapshotIsolated(t *testing.T) {
	deadline := int64(1000)
	definition := &planbundle.CompiledProcess{Steps: []planbundle.CompiledProcessStep{{StepKey: "wait", StepType: "DELAY", OccupiesAction: true}}}
	process := NewProcess(ProcessSeed{Snapshot: model.ProcessInstanceSnapshot{Owner: "source", UseKey: "use", Status: "active", ActualCosts: map[string]float64{"mana": 10}}, Definition: definition, StepIndex: -1})
	var state State
	state.AddProcess(process)
	frozen := process.Snapshot()
	change := StageProcess(process)
	change.EnterStep(0, definition.Steps[0], 0)
	change.SetTiming(deadline, &deadline)
	change.SetActualCost("mana", 20)
	if !change.ReconcileOccupancy(process, 0) {
		t.Fatal("new occupancy rejected")
	}
	if process.StepVersion() != 0 || process.Costs().At("mana") != 10 || process.OccupiesAction("source") {
		t.Fatal("unpublished state escaped")
	}
	change.Publish(process)
	if process.Reference().Slot != 0 || !process.Reference().Present || !process.OccupiesAction("source") || process.TimerAt() != 1000 || process.Costs().At("mana") != 20 {
		t.Fatal("commit lost identity or state")
	}
	frozen.ActualCosts["mana"] = 100
	returned := process.ActionOccupancies()
	returned[0].StepVersion = 100
	returnedDeadline := process.ExpiresAtMs()
	*returnedDeadline = 2000
	if process.Costs().At("mana") != 20 || process.ActionOccupancies()[0].StepVersion != 1 || process.TimerAt() != 1000 {
		t.Fatal("returned snapshot modified published state")
	}
	failed := StageProcess(process)
	failed.Finish("failed", "ACTIVE_CANCELLED", 500)
	if !failed.ReconcileOccupancy(process, 500) {
		t.Fatal("release rejected")
	}
	if process.Status() != "active" || process.ActionOccupancies()[0].FinishedAtMs != nil {
		t.Fatal("failed tentative transition changed publication")
	}
}

func TestProcessIdentityConstructionKeepsEmptyAndDelimitedIdentities(t *testing.T) {
	for _, row := range []model.ProcessInstanceSnapshot{{}, {Owner: "source", ProviderRef: "a", ProcessKey: "p", UseKey: "u"}} {
		p := NewProcess(ProcessSeed{Snapshot: row})
		mount := row.Owner + "\x00" + row.ProviderRef + "\x00" + row.ProcessKey
		if p.MountKey() != mount || p.StableKey() != mount+"\x00"+row.UseKey || p.MountKey() == "" || p.StableKey() == "" {
			t.Fatal("constructor did not initialize identity", row)
		}
	}
}

func TestProcessRepeatAdvanceChecksActualFrozenSegment(t *testing.T) {
	next, end := int64(5), int64(20)
	definition := &planbundle.CompiledProcess{Steps: []planbundle.CompiledProcessStep{{StepType: "CHANNEL", FirstExecution: "CUSTOM_WINDOW"}}}
	process := NewProcess(ProcessSeed{Definition: definition, StepIndex: 0, Snapshot: model.ProcessInstanceSnapshot{StepVersion: 1, ExpiresAtMs: &end, Repeat: &model.ProcessRepeatSnapshot{ExecutionCount: 2, FirstExecutionOffsetMs: 5, LastExecutionOffsetMs: 10, NextExecutionAtMs: &next}}})
	changes := StageProcess(process)
	if _, valid := changes.AdvanceRepeat(4); valid {
		t.Fatal("non-segment time accepted")
	}
	if timer, valid := changes.AdvanceRepeat(5); !valid || !timer || *changes.View().Repeat().NextExecutionAtMs != 10 {
		t.Fatal("first segment timing changed")
	}
	if timer, valid := changes.AdvanceRepeat(10); !valid || !timer || changes.View().Repeat().NextExecutionAtMs != nil {
		t.Fatal("channel complete duration was lost")
	}
}
