package action

import (
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestDriverProgramsAndDeathFactsKeepZeroAndFirstIdentity(t *testing.T) {
	var state State
	state.InitDriverEntries(2)
	state.SetDriverCondition(0, 0)
	state.SetDriverInterval(1, 0)
	if id, ok := state.DriverCondition(0); !ok || id != 0 {
		t.Fatal("program zero is a valid condition", id, ok)
	}
	if _, ok := state.DriverCondition(1); ok {
		t.Fatal("missing condition became program zero")
	}
	if _, ok := state.DriverInterval(-1); ok {
		t.Fatal("out-of-range interval is present")
	}
	state.RecordSkillTargetKilled(0)
	state.RecordSkillTargetKilled(20)
	if at, ok := state.SkillTargetKilledAt(); !ok || at != 0 {
		t.Fatal("first death at zero must survive later observations", at, ok)
	}
	state.MarkDead("source")
	if !state.Dead("source") || state.Dead("target") {
		t.Fatal("death facts crossed owners")
	}
	state.InitProcessFacts()
	state.SetProcessFact("entry", model.ProcessCommandFact{UseRef: "use:original"})
	fact := state.ProcessFact("entry")
	fact.UseRef = "use:mutated"
	if !state.HasProcessFact("entry") || state.ProcessFact("entry").UseRef != "use:original" {
		t.Fatal("fact read exposed writable identity")
	}
	state.RemoveProcessFact("entry")
	if state.HasProcessFact("entry") {
		t.Fatal("removed fact remained visible")
	}
}
