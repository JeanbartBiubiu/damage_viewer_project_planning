package execution

import (
	"encoding/json"
	"testing"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func followDamageCandidate(key, scope, follow string) model.SkillHitCandidate {
	candidate := damageCand(key, key+"_occurrence", key+"_result", scope, 0)
	candidate.EventValueConditions = nil
	candidate.Operations[0].DamageType = "damage/physics"
	candidate.SpellShieldFollowCandidateKey = model.SkillHitFollowCandidateKey(follow)
	return candidate
}

func followBasicAttackInput(t *testing.T, producerSelected, otherBlocker bool) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	input, run := continuousAttackInput(1, 10000, 10, 0, 0, 100)
	candidates := &input.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates
	(*candidates)[0].AttackDamageRole = model.AttackDamageRolePrimary
	producer := followDamageCandidate("empower", model.SpellShieldScopeResult, "")
	producer.ParticipationCondition = timedShieldExpr(0)
	if producerSelected {
		producer.ParticipationCondition = timedShieldExpr(1)
	}
	// 跟随者刻意位于生产者之前，验证引用不依赖候选执行顺序。
	follower := followDamageCandidate("extra", "", "empower")
	*candidates = append(*candidates, follower, producer)
	if otherBlocker {
		*candidates = append(*candidates, followDamageCandidate("other", model.SpellShieldScopeResult, ""))
	}
	mountEmpoweredSpellShield(&input, &run, false)
	return input, run
}

func TestSpellShieldFollowKeepsPrimaryAndConsumesOneRealShield(t *testing.T) {
	input, run := followBasicAttackInput(t, true, false)
	state := primaryShieldState(t, input, run)
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := state.buildDoneResult(false)
	if done.Summary.SourceDamageDealt != 10 || done.Summary.TargetFinalHp != 9990 || len(done.DamageRecords) != 1 ||
		len(done.FinalSnapshot.Combatants[1].Providers) != 0 || len(emittedEventsByRef(done, model.EventTypeSpellShieldBlocked)) != 1 {
		t.Fatal(done.Summary, done.DamageRecords, done.FinalSnapshot.Combatants[1].Providers)
	}
	if done.DamageRecords[0]["postDefenseDamage"] != float64(10) {
		t.Fatal("only producer and follower should be blocked", done.DamageRecords)
	}
}

func TestSpellShieldFollowWithoutShieldKeepsBothDamageResults(t *testing.T) {
	input, run := followBasicAttackInput(t, true, false)
	input.SharedProviders = input.SharedProviders[:len(input.SharedProviders)-1]
	done := runSkillHit(t, input, run)
	if done.Summary.SourceDamageDealt != 210 || len(done.DamageRecords) != 3 || len(emittedEventsByRef(done, model.EventTypeSpellShieldBlocked)) != 0 {
		t.Fatal(done.Summary, done.DamageRecords)
	}
}

func TestSpellShieldFollowDoesNotNominateOrFollowAnotherResult(t *testing.T) {
	for _, otherBlocker := range []bool{false, true} {
		input, run := followBasicAttackInput(t, false, otherBlocker)
		state := primaryShieldState(t, input, run)
		if err := state.runLoop(); err != nil {
			t.Fatal(err)
		}
		done := state.buildDoneResult(false)
		if done.Summary.SourceDamageDealt != 110 || done.Summary.TargetFinalHp != 9890 {
			t.Fatal(otherBlocker, done.Summary, done.DamageRecords)
		}
		wantShields, wantBlocks := 1, 0
		if otherBlocker {
			wantShields, wantBlocks = 0, 1
		}
		if len(done.FinalSnapshot.Combatants[1].Providers) != wantShields || len(emittedEventsByRef(done, model.EventTypeSpellShieldBlocked)) != wantBlocks {
			t.Fatal(otherBlocker, done.FinalSnapshot.Combatants[1].Providers, done.Evidence)
		}
	}
}

func TestSpellShieldFollowCompilesOnlyOneDirectSamePlanDependency(t *testing.T) {
	for _, variant := range []string{"missing", "self", "chain", "cycle", "own_scope", "primary", "replacement", "non_damage", "source", "persistent", "repeat", "producer_null_scope", "blocked_only"} {
		t.Run(variant, func(t *testing.T) {
			input, _ := followBasicAttackInput(t, true, false)
			candidates := input.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates
			follower, producer := &candidates[2], &candidates[3]
			switch variant {
			case "missing":
				follower.SpellShieldFollowCandidateKey = "absent"
			case "self":
				follower.SpellShieldFollowCandidateKey = model.SkillHitFollowCandidateKey(follower.CandidateKey)
			case "chain":
				producer.SpellShieldFollowCandidateKey = "damage"
			case "cycle":
				producer.SpellShieldFollowCandidateKey = model.SkillHitFollowCandidateKey(follower.CandidateKey)
			case "own_scope":
				follower.SpellShieldBlockScope = hitScope(model.SpellShieldScopeResult)
			case "primary":
				follower.AttackDamageRole = model.AttackDamageRolePrimary
			case "replacement":
				follower.AttackDamageRole = model.AttackDamageRoleReplacePrimary
			case "non_damage":
				follower.Semantic.ResultType = model.SkillHitResultAttributeChange
			case "source":
				follower.Semantic.Target = model.SkillHitTargetSOURCE
			case "persistent":
				follower.Semantic.Moment = model.SkillHitMomentPersistent
			case "repeat":
				follower.Operations[0].RepeatCount = 2
			case "producer_null_scope":
				producer.SpellShieldBlockScope = nil
			case "blocked_only":
				follower.EventValueConditions = []model.SkillHitEventValueCondition{{Key: "blocked", Comparator: "eq", Value: authoringConst(1)}}
			}
			if result := compilebundle.CompileGeneric(input); result.OK {
				t.Fatal("invalid follow dependency compiled")
			}
		})
	}
	for _, raw := range []string{`null`, `""`, `" "`, `" key"`, `1`, `true`} {
		var candidate model.SkillHitCandidate
		if err := json.Unmarshal([]byte(`{"spellShieldFollowCandidateKey":`+raw+`}`), &candidate); err == nil {
			t.Fatal("invalid explicit follow key decoded", raw)
		}
	}
}
