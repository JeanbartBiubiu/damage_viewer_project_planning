package hit

import (
	"testing"
	"tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

type countedWindowFixture struct {
	processes []*actionpkg.ProcessView
	live      bool
}

func (f countedWindowFixture) EmpoweredWindowCount() int { return len(f.processes) }

func (f countedWindowFixture) EmpoweredWindowAt(index int) *actionpkg.ProcessView {
	return f.processes[index]
}

func (f countedWindowFixture) EmpoweredMountLive(owner, provider string, definition uint16) bool {
	return f.live
}

func countedProcessForTest(status string) *actionpkg.ProcessView {
	expiry := int64(50)
	return actionpkg.NewProcess(actionpkg.ProcessSeed{Snapshot: model.ProcessInstanceSnapshot{
		Owner: "source", ProviderRef: "empower", ProcessKey: "window", SkillKey: "empower:q", UseKey: "activation",
		Target: "source", Status: status, ExpiresAtMs: &expiry, StepVersion: 4, StepExecutionIndex: 0,
		EmpoweredAttackWindow: &model.ProcessEmpoweredAttackWindow{MaximumAttackCount: 2},
	}})
}

func TestCountedStartRejectsCompetingWindowBeforeReserving(t *testing.T) {
	first, second := countedProcessForTest("active"), countedProcessForTest("active")
	facts := CountedStartFacts{HasAttack: true, Owner: "source"}
	_, err := PrepareCountedStart(facts, "attack", "target", 10, countedWindowFixture{[]*actionpkg.ProcessView{first, second}, true}, Identity{})
	if err == nil || err.Path != "processInstances" || first.WindowConsumed() != 0 || second.WindowConsumed() != 0 {
		t.Fatal("ambiguous windows changed a consumption", err, first.WindowConsumed(), second.WindowConsumed())
	}
}

func TestCountedStartOnlyStagesTheActualAcceptedAttack(t *testing.T) {
	original := countedProcessForTest("active")
	facts := CountedStartFacts{HasAttack: true, HasCurrent: true, Ready: true, HasUse: true, Owner: "source",
		SkillKey: "attack", CurrentUse: "attack:1", StartedAt: 10, Target: "target", UseSource: "source", UseSkill: "attack"}
	fixture := countedWindowFixture{[]*actionpkg.ProcessView{original}, true}
	facts.StartedAt = 9
	if _, err := PrepareCountedStart(facts, "attack:1", "target", 10, fixture, Identity{}); err == nil || original.WindowConsumed() != 0 {
		t.Fatal("foreign start reserved a charge", err)
	}
	facts.StartedAt = 10
	prepared, err := PrepareCountedStart(facts, "attack:1", "target", 10, fixture, Identity{})
	if err != nil || prepared.Index != 0 || original.WindowConsumed() != 0 {
		t.Fatal("preparation published charge", err, original.WindowConsumed())
	}
	staged := prepared.Changes.View()
	if staged.WindowConsumed() != 1 || staged.EmpoweredAttackWindow().PendingHitCount != 1 || staged.Consumption(0).UseRef != "attack:1" {
		t.Fatal("missing staged real attack identity", staged.Snapshot())
	}
}

func TestCountedHitAfterWindowCompletionRetainsOriginalPendingAttack(t *testing.T) {
	original := countedProcessForTest("complete")
	changes := actionpkg.StageProcess(original)
	changes.ReserveEmpowered("attack:1", "target", 10)
	changes.Publish(original)
	sequence := 0
	input := CountedHitInput{Original: original, Index: 0, UseKey: "attack:1", UseSource: "source", EventSource: "source",
		Target: "target", NowMs: 70, Mounted: true, Facts: Facts{IsBasicAttack: true, OccurrenceID: 77, HitSequence: &sequence},
		History: ActivationHistory{Present: true, Source: "source", SkillKey: "empower:q", State: model.SkillHitHistoryComplete}}
	prepared, err := PrepareCountedHit(input, Identity{})
	if err != nil || prepared.Changes == nil {
		t.Fatal("original pending attack lost after window end", err)
	}
	staged := prepared.Changes.View()
	if staged.Status() != "complete" || staged.StepVersion() != 4 || staged.StepExecutionIndex() != 0 ||
		staged.EmpoweredAttackWindow().PendingHitCount != 0 || staged.Consumption(0).HitRef == nil ||
		*staged.Consumption(0).HitRef != "hit:77" || *staged.Consumption(0).HitSequence != 0 ||
		original.EmpoweredAttackWindow().PendingHitCount != 1 {
		t.Fatal("real hit changed timer, version, or published early", staged.Snapshot(), original.Snapshot())
	}
	prepared.Changes.Publish(original)
	repeated, err := PrepareCountedHit(input, Identity{})
	if err != nil || repeated.Changes != nil {
		t.Fatal("resolved original reservation ran twice", err)
	}
}
