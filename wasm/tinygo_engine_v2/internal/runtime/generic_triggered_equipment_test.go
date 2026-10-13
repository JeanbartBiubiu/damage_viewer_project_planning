package runtime

import (
	"testing"
	"tinygo_engine_v2/internal/model"
)

func addOnHitEquipment(input *model.CompileRequest, request *model.RunRequest, actorIndex int, amount float64) {
	owner := input.Combatants[actorIndex].Key
	key := owner + "_on_hit_equipment"
	addFixedEquipment(input, request, actorIndex, key, "hp", 0)
	definition := key + "_passive"
	input.SharedProviders = append(input.SharedProviders, model.ProviderDefinition{ProviderKey: definition, StableID: key, Kind: "item",
		Listeners: []model.ListenerDefinition{{ListenerKey: definition, MaxTriggersPerEvent: 1,
			EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackHit, "event/source_owner"}},
			Operations:   []model.OperationDefinition{{Operation: "damage", Target: "target", Ref: definition, DamageType: "damage/physics", Amount: authoringAmount(authoringConst(amount))}},
		}},
	})
	input.Combatants[actorIndex].Providers = append(input.Combatants[actorIndex].Providers, model.CombatantProviderMount{ProviderRef: definition, DefinitionRef: definition})
	request.InitialSnapshot.Combatants[actorIndex].Providers = append(request.InitialSnapshot.Combatants[actorIndex].Providers,
		model.CombatantProviderSnapshot{ProviderRef: definition, DefinitionRef: definition, Source: owner, Owner: owner, Stacks: 1})
}

func TestContinuousEquipmentOnHitOwnerIsolationAndRecordBudgets(t *testing.T) {
	input, request := continuousAttackInput(1, 10000, 100, 0, 0, 2000)
	addOnHitEquipment(&input, &request, 0, 15)
	addOnHitEquipment(&input, &request, 1, 700)
	for _, truncate := range []bool{false, true} {
		if truncate {
			zero := 0
			request.RecordBudget = &model.RecordBudget{MaxAttackRecords: &zero, MaxDamageRecords: &zero}
		}
		done := authoringRun(t, input, request)
		if !done.Summary.Execution.Complete || done.Summary.SourceDamageDealt != 345 || done.Summary.TargetDamageDealt != 0 || done.Summary.BasicAttack.CompletedCount != 3 || done.Recording.DamageRecordCount != 6 {
			t.Fatal(truncate, done.Summary, done.Recording)
		}
		for _, attack := range done.AttackRecords {
			if attack.PostDefenseDamage != 115 || attack.ActualHpLoss != 115 || attack.FinalReadyAtMs == nil || *attack.FinalReadyAtMs != *attack.ReadyAtMs {
				t.Fatal(attack)
			}
		}
	}
}

func TestContinuousEquipmentOnHitCanKillAfterBodyAndSettlesTail(t *testing.T) {
	input, request := continuousAttackInput(1, 110, 100, 0, 0, 2000)
	addOnHitEquipment(&input, &request, 0, 15)
	done := authoringRun(t, input, request)
	if !done.Summary.Execution.Complete || !done.Summary.Execution.TargetKilled || *done.Summary.Execution.TargetKilledAtMs != 0 || done.Summary.TargetHpLoss != 110 || done.Summary.SourceDamageDealt != 115 || done.Summary.BasicAttack.CompletedCount != 1 {
		t.Fatal(done.Summary)
	}
}
