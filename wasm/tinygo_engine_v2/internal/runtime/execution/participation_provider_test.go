package execution

import (
	testing "testing"
	model "tinygo_engine_v2/internal/model"
)

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
			for i, instanceValues := 0, actor.instances.Providers(); i < instanceValues.Len(); i++ {
				if actor.instances.Providers().At(i).ProviderRef == "passive_mount" {
					expired := actor.instances.Providers().At(i)
					expired.ExpireAt = 1
					actor.instances.ReplaceProvider(i, expired)
				}
			}
			state.combatants["source"] = actor
		}
		if err := state.runLoop(); err != nil {
			t.Fatal(err)
		}
		for instanceIndex, instanceValues := 0, state.combatants["target"].instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
			provider := instanceValues.At(instanceIndex)
			if provider.DefinitionRef == "status:stun" {
				t.Fatal("inactive participation provider granted control from its default state")
			}
		}
	}
}
