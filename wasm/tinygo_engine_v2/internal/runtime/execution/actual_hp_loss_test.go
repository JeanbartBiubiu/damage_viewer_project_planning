package execution

import (
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	plan "tinygo_engine_v2/internal/plan"
)

func TestDamageTakenActualHPLossKeepsEachPacketSnapshot(t *testing.T) {
	s := initializedOwnShield(t)
	f := s.newExecutionFrame("target", "source", "packet_snapshots")
	if err := f.executeOperations(plan.CompiledAbility{}, shieldBreakingOperations(t, s)); err != nil {
		t.Fatal(err)
	}
	want := []float64{100, 200}
	for _, event := range f.pendingEvents {
		if event.eventType != model.EventTypeDamageTaken {
			continue
		}
		fact := event.snapshot.damageSnapshot
		if len(want) == 0 || !fact.HasActualHPLoss || fact.ActualHPLoss != want[0] {
			t.Fatal("damage packet lost its immutable HP damage", fact, want)
		}
		want = want[1:]
	}
	if len(want) != 0 {
		t.Fatal("missing packet snapshots", want)
	}
}
