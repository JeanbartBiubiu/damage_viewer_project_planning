package execution

import (
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
)

func TestSpecialAttackStatusPresenceChoosesOneBodyAndExpiresAtBoundary(test *testing.T) {
	for _, lifetime := range []float64{1000, 3000} {
		input, request := configuredMovementEquipment(2000)
		input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: "status/ordinary_slow", Domain: "status"})
		input.Combatants[0].Attributes["attack_speed"] = authoringSlot(1)
		request.InitialSnapshot.Combatants[0].Attributes["attack_speed"] = authoringSlot(1)
		request.DriverPlan.BasicAttack.AttackSpeedInputMax = 1
		input.SharedProviders[1].Lifecycle.DurationMs = authoringAmount(authoringConst(lifetime))
		hit := input.SharedProviders[0].Abilities[2].Operations[0].SkillHit
		normal := hit.Candidates[0]
		normal.ParticipationCondition = authoringAmount(authoringBinary("eq", authoringRead("target.status.ordinary_slow.present"), authoringConst(0)))
		special := normal
		special.CandidateKey, special.ResultKey = "status_body", "status_body"
		special.ParticipationCondition = authoringAmount(authoringBinary("eq", authoringRead("target.status.ordinary_slow.present"), authoringConst(1)))
		special.Operations = append([]model.OperationDefinition(nil), normal.Operations...)
		special.Operations[0].Ref = "status_body"
		special.Operations[0].Amount = authoringAmount(authoringConst(200))
		hit.Candidates = []model.SkillHitCandidate{normal, special}
		done := authoringRun(test, input, request)
		expected := float64(300)
		if lifetime == 3000 {
			expected = 500
		}
		if done.Summary.SourceDamageDealt != expected || done.Summary.BasicAttack.HitCount != 3 || len(done.DamageRecords) != 3 || done.DamageRecords[0]["operationRef"] != "body" {
			test.Fatal("conditional bodies duplicated or read a future/expired status", done.Summary, done.DamageRecords)
		}
		state, err := newGenericRunState(authoringCompile(test, input), request)
		if err != nil || state.runLoop() != nil {
			test.Fatal(err)
		}
		context := state.newExecutionFrame("source", "target", authoringRef("native_hit")).evalContext(state.compiled.Abilities[2])
		if context.SourceStatuses["ordinary_slow"] || !context.TargetStatuses["ordinary_slow"] {
			test.Fatal("status presence crossed party ownership")
		}
		input.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates[0].ParticipationCondition = authoringAmount(authoringRead("target.status.undeclared.present"))
		if result := compilebundle.CompileGeneric(input); result.OK {
			test.Fatal("unknown status key compiled")
		}
	}
}
