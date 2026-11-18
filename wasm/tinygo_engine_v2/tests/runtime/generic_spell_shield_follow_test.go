package runtime_test

import (
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestSpellShieldFollowPublicCompileRunAndOriginalShieldConsumption(t *testing.T) {
	for _, selected := range []bool{false, true} {
		producer := damageCand("producer", "producer_occurrence", "producer_result", model.SpellShieldScopeResult, 0)
		producer.ParticipationCondition = hitConstAmt(0)
		if selected {
			producer.ParticipationCondition = hitConstAmt(1)
		}
		follower := damageCand("follower", "follower_occurrence", "follower_result", "", 0)
		follower.SpellShieldFollowCandidateKey = "producer"
		c, r := withSkillHit(t, []model.SkillHitCandidate{follower, producer}, []model.ProviderDefinition{spellShieldProvider()}, nil,
			[]model.DriverEntry{hitEntry("hit", 0, 0)},
			[]model.SkillUseFact{{UseKey: "same_actual_use", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}},
			[]model.SkillHitFact{{DriverEntryKey: "hit", UseRef: hitUse("same_actual_use")}}, 50)
		expire := int64(5000)
		r.InitialSnapshot.Combatants[1].Providers = []model.CombatantProviderSnapshot{{ProviderRef: "actual_spell_shield", DefinitionRef: "shield:spell", Source: "source", Owner: "target", Stacks: 1, ExpireAt: &expire}}
		done := runSkillHit(t, c, r)
		wantDamage, wantHP, wantShields := float64(100), float64(900), 1
		if selected {
			// 两项都受挡，真实法盾自身的40治疗只执行一次。
			wantDamage, wantHP, wantShields = 0, 1040, 0
		}
		if done.Summary.SourceDamageDealt != wantDamage || targetHP(t, done) != wantHP || len(done.FinalSnapshot.Combatants[1].Providers) != wantShields {
			t.Fatal(selected, done.Summary, done.FinalSnapshot.Combatants[1].Providers)
		}
	}
}
