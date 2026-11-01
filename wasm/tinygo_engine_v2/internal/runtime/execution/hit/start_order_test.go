package hit

import (
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestAttackStartOrderKeepsTimePriorityIndexAndUnknownIndex(t *testing.T) {
	use := "actual-use"
	starts := map[string]model.AttackStartFact{"start": {UseRef: use}}
	state := State{facts: map[string]model.SkillHitFact{"hit": {DriverEntryKey: "hit", UseRef: &use}}}
	identity := Identity{SchemaHash: "schema", RulesHash: "rules", SessionID: "session"}
	for _, test := range []struct {
		name    string
		entries []model.DriverEntry
		allowed bool
	}{
		{name: "earlier_time", entries: []model.DriverEntry{{EntryKey: "start", FirstAtMs: 1, Priority: 5}, {EntryKey: "hit", FirstAtMs: 2}}, allowed: true},
		{name: "later_time", entries: []model.DriverEntry{{EntryKey: "start", FirstAtMs: 2}, {EntryKey: "hit", FirstAtMs: 1}}},
		{name: "earlier_priority", entries: []model.DriverEntry{{EntryKey: "hit", Priority: 1}, {EntryKey: "start", Priority: 0}}, allowed: true},
		{name: "later_priority", entries: []model.DriverEntry{{EntryKey: "start", Priority: 1}, {EntryKey: "hit", Priority: 0}}},
		{name: "earlier_array_index", entries: []model.DriverEntry{{EntryKey: "start"}, {EntryKey: "hit"}}, allowed: true},
		{name: "later_array_index", entries: []model.DriverEntry{{EntryKey: "hit"}, {EntryKey: "start"}}},
		{name: "missing_start_is_max_index", entries: []model.DriverEntry{{EntryKey: "hit"}}},
		{name: "missing_hit_keeps_original_max_index", entries: []model.DriverEntry{{EntryKey: "start"}}, allowed: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			issue := state.ValidateAttackStartOrder(starts, test.entries, identity)
			if (issue == nil) != test.allowed {
				t.Fatalf("allowed=%v issue=%+v", test.allowed, issue)
			}
			if issue != nil && (issue.Code != model.GenericErrUnknownRef || issue.Path != "attackStartFacts" || issue.Ref != "start vs hit" || issue.SchemaHash != identity.SchemaHash || issue.RulesHash != identity.RulesHash || issue.SessionID != identity.SessionID) {
				t.Fatalf("order failure lost the actual call identity: %+v", issue)
			}
		})
	}
}
