package runtime

import (
	"testing"
	"tinygo_engine_v2/internal/model"
)

func TestParticipationProviderFreezesOriginalSiblingState(t *testing.T) {
	for _, initial := range []float64{3, 4} {
		condition := model.GenericFormulaExpr{Op: "gte", Args: []model.GenericFormulaExpr{{Op: "read", Path: "provider.state.stacks"}, hitConst(4)}}
		control := stunCand("configured_control", "same_hit", "control", "SKILL")
		control.ParticipationProviderRef, control.ParticipationCondition = "passive_mount", &condition
		damage := damageCand("configured_damage", "same_hit", "damage", "SKILL", 0)
		c, r := withSkillHit(t, []model.SkillHitCandidate{damage, control}, []model.ProviderDefinition{stunProvider()}, nil,
			[]model.DriverEntry{{EntryKey: "hit", AbilityRef: skillHitAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0}},
			[]model.SkillUseFact{{UseKey: "one_cast", Source: "source", SkillKey: "author:q", HistoryState: "complete"}},
			[]model.SkillHitFact{{DriverEntryKey: "hit", UseRef: hitUse("one_cast"), Sequence: seqN(1)}}, 10)
		ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "event/source_owner", Domain: "event"})
		below := model.GenericFormulaExpr{Op: "lt", Args: condition.Args}
		passive := model.ProviderDefinition{ProviderKey: "configured_passive", Kind: "character", StableID: "configured_passive",
			InitialStateSchema: map[string]interface{}{"stacks": initial}, Listeners: []model.ListenerDefinition{
				{ListenerKey: "consume", EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit, "event/source_owner"}}, Condition: &condition, MaxTriggersPerEvent: 1,
					Operations: []model.OperationDefinition{{Operation: "state_change", Target: "self", Types: []string{"state_scope/provider"}, Ref: "stacks", ValuePolicy: "set", Amount: hitConstAmt(0)}}},
				{ListenerKey: "charge", EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit, "event/source_owner"}}, Condition: &below, MaxTriggersPerEvent: 1,
					Operations: []model.OperationDefinition{{Operation: "state_change", Target: "self", Types: []string{"state_scope/provider"}, Ref: "stacks", ValuePolicy: "add", Amount: hitConstAmt(1)}}},
			}}
		c.SharedProviders = append(c.SharedProviders, passive)
		c.Combatants[0].Providers = append(c.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: "passive_mount", DefinitionRef: passive.ProviderKey})
		r.InitialSnapshot.Combatants[0].Providers = append(r.InitialSnapshot.Combatants[0].Providers, model.CombatantProviderSnapshot{ProviderRef: "passive_mount", DefinitionRef: passive.ProviderKey, Source: "source", Owner: "source", Stacks: 1})
		done := processRun(t, c, r)
		found := false
		for _, instance := range done.FinalSnapshot.Combatants[1].Providers {
			found = found || instance.DefinitionRef == "status:stun"
		}
		if found != (initial == 4) {
			t.Fatalf("initial=%v control=%v; fourth cast must only charge", initial, found)
		}
		bag := done.FinalSnapshot.Combatants[0].ProviderState["passive_mount"].(map[string]interface{})
		want := float64(4)
		if initial == 4 {
			want = 0
		}
		if got := bag["state"].(map[string]interface{})["stacks"]; got != want {
			t.Fatalf("initial=%v stacks=%v want=%v", initial, got, want)
		}
	}
}

func TestParticipationProviderRemovedOrExpiredCannotUseDefaultFullState(t *testing.T) {
	for _, removed := range []bool{true, false} {
		condition := model.GenericFormulaExpr{Op: "gte", Args: []model.GenericFormulaExpr{{Op: "read", Path: "provider.state.stacks"}, hitConst(4)}}
		control := stunCand("control", "hit", "control", "SKILL")
		control.ParticipationProviderRef, control.ParticipationCondition = "passive_mount", &condition
		c, r := withSkillHit(t, []model.SkillHitCandidate{damageCand("damage", "hit", "damage", "SKILL", 0), control}, []model.ProviderDefinition{stunProvider()}, nil,
			[]model.DriverEntry{{EntryKey: "hit", AbilityRef: skillHitAbilityRef(), Source: "source", Target: "target", FirstAtMs: 10}},
			[]model.SkillUseFact{{UseKey: "cast", Source: "source", SkillKey: "author:q", HistoryState: "complete"}},
			[]model.SkillHitFact{{DriverEntryKey: "hit", UseRef: hitUse("cast"), Sequence: seqN(1)}}, 10)
		passive := model.ProviderDefinition{ProviderKey: "passive", Kind: "character", StableID: "passive", InitialStateSchema: map[string]interface{}{"stacks": float64(4)}}
		c.SharedProviders = append(c.SharedProviders, passive)
		c.Combatants[0].Providers = append(c.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: "passive_mount", DefinitionRef: passive.ProviderKey})
		r.InitialSnapshot.Combatants[0].Providers = append(r.InitialSnapshot.Combatants[0].Providers, model.CombatantProviderSnapshot{ProviderRef: "passive_mount", DefinitionRef: passive.ProviderKey, Source: "source", Owner: "source", Stacks: 1})
		state := frameCommitState(t, c, r)
		if removed {
			state.removeProviderInstance("source", "passive_mount", state.evalContextForCombatants("source", "target"), model.EvidenceKindProviderRemove)
		} else {
			actor := state.combatants["source"]
			for i := range actor.providers {
				if actor.providers[i].ProviderRef == "passive_mount" {
					actor.providers[i].ExpireAt = 1
				}
			}
			state.combatants["source"] = actor
		}
		if err := state.runLoop(); err != nil {
			t.Fatal(err)
		}
		for _, provider := range state.combatants["target"].providers {
			if provider.DefinitionRef == "status:stun" {
				t.Fatal("inactive participation provider granted control from its default state")
			}
		}
	}
}
