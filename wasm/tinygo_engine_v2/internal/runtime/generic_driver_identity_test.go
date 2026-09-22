package runtime

import (
	"testing"
	"tinygo_engine_v2/internal/model"
)

func TestDriverReverseActorsPreserveUseAndResourceOwner(t *testing.T) {
	for _, affordable := range []bool{false, true} {
		t.Run(map[bool]string{false: "target_cannot_pay", true: "target_can_pay"}[affordable], func(t *testing.T) {
			entry := model.DriverEntry{EntryKey: "reverse", AbilityRef: "target.provider[champion:source_demo].ability[skill_hit]", Source: "target", Target: "source"}
			c, r := withSkillHit(t, []model.SkillHitCandidate{damageCand("d", "e", "r", "", 0)}, nil, nil,
				[]model.DriverEntry{entry}, []model.SkillUseFact{{UseKey: "reverse_use", Source: "target", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}},
				[]model.SkillHitFact{{DriverEntryKey: "reverse", UseRef: hitUse("reverse_use")}}, 50)
			c.Combatants[1].Providers = append(c.Combatants[1].Providers, c.Combatants[0].Providers[0])
			r.InitialSnapshot.Combatants[1].Providers = append(r.InitialSnapshot.Combatants[1].Providers, model.CombatantProviderSnapshot{
				ProviderRef: "champion:source_demo", DefinitionRef: "champion:source_demo", Source: "target", Owner: "target", Stacks: 1, State: map[string]interface{}{},
			})
			for i := range c.Combatants {
				mana := 50.0
				if (i == 1) == affordable {
					mana = 200
				}
				c.Combatants[i].Resources["mana"] = model.ResourceSlotDef{Current: mana, Max: 200}
				r.InitialSnapshot.Combatants[i].Resources["mana"] = model.ResourceSlotDef{Current: mana, Max: 200}
				c.Combatants[i].Attributes["hp"] = model.AttributeSlotDef{Base: 1000, Current: 1000, Resolved: 1000, Max: 1000}
				r.InitialSnapshot.Combatants[i].Attributes["hp"] = c.Combatants[i].Attributes["hp"]
			}
			c.SharedProviders[0].Abilities[0].Cost = &model.AbilityCost{ResourceKey: "mana", Amount: hitConst(100)}
			done := runSkillHit(t, c, r)
			hits := skillHitItems(done)
			if !affordable {
				if len(hits) != 0 {
					t.Fatalf("resource gate must inspect actual target actor: %+v", hits)
				}
				return
			}
			if len(hits) != 1 || hits[0].Data["source"] != "target" || hits[0].Data["target"] != "source" || hits[0].Data["useRef"] != "reverse_use" {
				t.Fatalf("driver actor keys must agree with validated use: %+v", hits)
			}
			for _, actor := range done.FinalSnapshot.Combatants {
				if actor.Key == "source" && (actor.Attributes["hp"].Current != 900 || actor.Resources["mana"].Current != 50) {
					t.Fatalf("source recipient: %+v", actor)
				}
				if actor.Key == "target" && (actor.Attributes["hp"].Current != 1000 || actor.Resources["mana"].Current != 100) {
					t.Fatalf("target caster: %+v", actor)
				}
			}
		})
	}
}
