package hit

import (
	"strconv"
	"testing"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func sameTimeState(t *testing.T, sequences bool) State {
	t.Helper()
	use := "use:q"
	uses := []model.SkillUseFact{{UseKey: use, Source: "source", SkillKey: "q", HistoryState: model.SkillHitHistoryComplete}}
	entries := []model.DriverEntry{
		{EntryKey: "first", Source: "source", Target: "target", FirstAtMs: 10},
		{EntryKey: "second", Source: "source", Target: "target", FirstAtMs: 10},
	}
	facts := []model.SkillHitFact{{DriverEntryKey: "first", UseRef: &use}, {DriverEntryKey: "second", UseRef: &use}}
	if sequences {
		first, second := 0, 1
		facts[0].Sequence, facts[1].Sequence = &first, &second
	}
	bindings := []DriverBinding{{HasSkillHit: true, SkillKey: "q"}, {HasSkillHit: true, SkillKey: "q"}}
	var state State
	if issue := state.Initialize(uses, facts, entries, bindings, Identity{}); issue != nil {
		t.Fatal(issue)
	}
	return state
}

func TestSameTimeUnknownOrderDoesNotInventFirstContact(t *testing.T) {
	for _, hasPrior := range []bool{false, true} {
		state := sameTimeState(t, false)
		var prior []string
		if hasPrior {
			prior = []string{"previous-target"}
		}
		history := NewHistory(prior)
		has, value := state.FirstContact("first", "use:q", model.SkillHitHistoryComplete, &history, 10)
		if has != hasPrior || value != 0 {
			t.Fatal("unknown order guessed the first contact", hasPrior, has, value)
		}
		history.Append("target")
		has, value = state.FirstContact("second", "use:q", model.SkillHitHistoryComplete, &history, 10)
		if has != hasPrior || value != 0 {
			t.Fatal("later contact changed the already frozen same-time group", hasPrior, has, value)
		}
		has, value = state.FirstContact("later", "use:q", model.SkillHitHistoryComplete, &history, 11)
		if !has || value != 0 {
			t.Fatal("subsequent known contact lost the actual earlier attempt", has, value)
		}
	}
}

func TestKnownSameTimeOrderAndUnknownHistoryStayDistinct(t *testing.T) {
	state := sameTimeState(t, true)
	history := NewHistory(nil)
	if has, value := state.FirstContact("first", "use:q", model.SkillHitHistoryComplete, &history, 10); !has || value != 1 {
		t.Fatal("the known first contact was lost", has, value)
	}
	history.Append("target")
	if has, value := state.FirstContact("second", "use:q", model.SkillHitHistoryComplete, &history, 10); !has || value != 0 {
		t.Fatal("same target contact was incorrectly treated as first again", has, value)
	}
	if has, value := state.FirstContact("second", "use:q", model.SkillHitHistoryUnknown, &history, 10); has || value != 0 {
		t.Fatal("unknown history was authorized by current contacts", has, value)
	}
}

func TestOccurrenceBudgetPreservesSequenceOnRejection(t *testing.T) {
	for _, test := range []struct{ budget, expected int }{{0, 256}, {1, 256}, {1000, 1000}, {10000, MaxOccurrences}} {
		var state State
		for expected := 1; expected <= test.expected; expected++ {
			sequence, accepted := state.NextOccurrence(test.budget)
			if !accepted || sequence != uint64(expected) {
				t.Fatal(test.budget, expected, sequence, accepted)
			}
		}
		if _, accepted := state.NextOccurrence(test.budget); accepted || state.OccurrenceCount() != uint64(test.expected) {
			t.Fatal("rejected attempt changed the actual occurrence count", test.budget, state.OccurrenceCount())
		}
	}
}

func TestHistoryOwnsPriorValuesAndCountsEveryRealContact(t *testing.T) {
	prior := []string{"target"}
	history := NewHistory(prior)
	prior[0] = "changed"
	history.Append("target")
	history.Append("target")
	if history.prior[0] != "target" || history.TotalCount() != 3 || history.ContactCount() != 2 {
		t.Fatal("history aliased the request or collapsed repeated real contacts", history)
	}
}

func TestHitInputFailureKeepsOriginalIdentityAndOrder(t *testing.T) {
	identity := Identity{SchemaHash: "schema", RulesHash: "rules", SessionID: "session"}
	uses := []model.SkillUseFact{
		{UseKey: "same", Source: "source", SkillKey: "q", HistoryState: model.SkillHitHistoryComplete},
		{UseKey: "same"},
	}
	var state State
	issue := state.Initialize(uses, []model.SkillHitFact{{}}, nil, nil, identity)
	if issue == nil || issue.Code != model.GenericErrUnknownRef || issue.Path != "skillUses[1].useKey" || issue.Ref != "same previously 0" || issue.SchemaHash != identity.SchemaHash || issue.RulesHash != identity.RulesHash || issue.SessionID != identity.SessionID {
		t.Fatalf("input failure moved past the original earlier use check: %+v", issue)
	}
}

func TestBlockRangeCannotExpandAfterFirstResultAndLedgerOwnsValue(t *testing.T) {
	plan := planbundle.CompiledSkillHit{Candidates: []planbundle.CompiledSkillHitCandidate{
		{CandidateKey: "one", EffectOccurrenceKey: "e1", ResultKey: "r1", HasBlockScope: true, InboundBlockEligible: true, BlockScope: model.SpellShieldScopeResult, Path: "candidates[0]"},
		{CandidateKey: "two", EffectOccurrenceKey: "e2", ResultKey: "r2", HasBlockScope: true, InboundBlockEligible: true, BlockScope: model.SpellShieldScopeSkill, Path: "candidates[1]"},
	}}
	if _, _, issue := FormBlockUnit(&plan, []int{0, 1}, 1, "use:q", Identity{}); issue == nil || issue.Path != "candidates[1].spellShieldBlockScope" || issue.Ref != "two" {
		t.Fatal("later skill scope expanded the original result scope", issue)
	}
	unit, found, issue := FormBlockUnit(&plan, []int{1, 0}, 1, "use:q", Identity{})
	if issue != nil || !found || unit.Scope != model.SpellShieldScopeSkill || !CoversCandidates(unit, &plan, []int{0}, 2, "use:q") || CoversCandidates(unit, &plan, []int{0}, 2, "other-use") {
		t.Fatal("skill-range reuse lost its actual originating use", unit, found, issue)
	}
	unit.ShieldOwner, unit.ShieldProviderRef = "target", "actual-shield"
	var state State
	if issue := state.StoreBlockUnit("use:q", unit, Identity{}); issue != nil {
		t.Fatal(issue)
	}
	unit.ShieldProviderRef = "changed"
	stored, found := state.BlockUnit("use:q")
	if !found || stored.ShieldProviderRef != "actual-shield" {
		t.Fatal("ledger borrowed a mutable parent freeze", stored)
	}
	for index := 1; index < MaxLedgerUnits; index++ {
		if issue := state.StoreBlockUnit(strconv.Itoa(index), unit, Identity{}); issue != nil {
			t.Fatal(issue)
		}
	}
	if issue := state.StoreBlockUnit("overflow", unit, Identity{SessionID: "actual-session"}); issue == nil || issue.Path != "skillUses" || issue.Ref != "overflow" || issue.SessionID != "actual-session" {
		t.Fatal("ledger capacity or failure identity changed", issue)
	}
}
