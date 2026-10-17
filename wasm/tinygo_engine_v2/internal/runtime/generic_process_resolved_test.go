package runtime

import (
	"testing"
	"tinygo_engine_v2/internal/model"
)

func TestProcessResolvedReadsActualHitsAndMisses(t *testing.T) {
	for _, miss := range []bool{false, true} {
		c, r := singleSkillInput(false)
		ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: model.EventTypeProcessResolved, Domain: "event"},
			model.TypeCatalogEntry{Key: "event/source_owner", Domain: "event"},
			model.TypeCatalogEntry{Key: "event/process_resolved/configured_spell/cast", Domain: "event"})
		c.SharedProviders[0].Listeners = append(c.SharedProviders[0].Listeners,
			model.ListenerDefinition{ListenerKey: "after_real_hit", MaxTriggersPerEvent: 1,
				EventMatcher: model.TypeMatcher{All: []string{model.EventTypeProcessResolved, "event/source_owner", "event/process_resolved/configured_spell/cast"}},
				Operations:   []model.OperationDefinition{{Operation: "state_change", Target: "self", Types: []string{"state_scope/provider"}, Ref: "contacts", ValuePolicy: "set", Amount: &model.GenericFormulaExpr{Op: "read", Path: "event.skill_use.contactCount"}}}})
		c.SharedProviders[0].InitialStateSchema = map[string]interface{}{"contacts": float64(0)}
		if miss {
			r.DriverPlan.SkillActions[0].HitBindings[0].Preset = "MISS"
		}
		done := processRun(t, c, r)
		want := float64(1)
		if miss {
			want = 0
		}
		bag := done.FinalSnapshot.Combatants[0].ProviderState["caster"].(map[string]interface{})
		if got := bag["state"].(map[string]interface{})["contacts"]; got != want {
			t.Fatalf("miss=%v contacts=%v want=%v", miss, got, want)
		}
		wantDamage := float64(100)
		if miss {
			wantDamage = 0
		}
		if done.Summary.SourceDamageDealt != wantDamage {
			t.Fatalf("wrong original hit: %+v", done.Summary)
		}
	}
}

func TestProcessResolvedIncludesPriorContactsAndDoesNotRepeatFinishedProcess(t *testing.T) {
	c, r := processBase(t, "IMMEDIATE")
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: model.EventTypeProcessResolved, Domain: "event"})
	r.SkillUses[0].PriorQualifiedContacts = []string{"target", "target"}
	c.SharedProviders[0].Listeners = []model.ListenerDefinition{{ListenerKey: "history", MaxTriggersPerEvent: 1,
		EventMatcher: model.TypeMatcher{All: []string{model.EventTypeProcessResolved}},
		Operations:   []model.OperationDefinition{{Operation: "heal", Target: "self", Amount: &model.GenericFormulaExpr{Op: "read", Path: "event.skill_use.contactCount"}}}}}
	r.InitialSnapshot.Combatants[0].Attributes["hp"] = model.AttributeSlotDef{Base: 1000, Resolved: 1000, Current: 400, Max: 1000}
	c.Combatants[0].Attributes["hp"] = r.InitialSnapshot.Combatants[0].Attributes["hp"]
	processEntry(&r, "duplicate", "start", "u1", 10)
	done := processRun(t, c, r)
	if done.FinalSnapshot.Combatants[0].Attributes["hp"].Current != 402 {
		t.Fatal("prior contacts lost or completion repeated")
	}
}
