package execution

import (
	testing "testing"
	model "tinygo_engine_v2/internal/model"
)

func periodicEquipmentDefinition(amount float64, first, interval int64) model.ProviderDefinition {
	return model.ProviderDefinition{Abilities: []model.AbilityDefinition{{AbilityKey: "periodic", Kind: "tick", SkillKey: "test_periodic",
		TickSpec: &model.TickSpec{StartDelayMs: first, IntervalMs: interval, OnTick: []model.OperationDefinition{
			{Operation: "damage", Target: "target", Ref: "periodic_damage", DamageType: "damage/physics", Amount: authoringAmount(authoringConst(amount))},
		}},
	}}}
}

func periodicOpponentDefenseInputs(input *model.CompileRequest, request *model.RunRequest) {
	setCombatantAttr(input, request, "source", "armor", authoringSlot(0))
	setCombatantAttr(input, request, "target", "armor_pen_percent", authoringSlot(0))
	setCombatantAttr(input, request, "target", "armor_pen_flat", authoringSlot(0))
}

func periodicSelfVampInputs(input *model.CompileRequest, request *model.RunRequest, rate float64) {
	efficiency := float64(1)
	input.Rules.VampRules = []model.VampRuleDefinition{{VampType: "LIFE_STEAL", SourceAttributeKey: "life_steal_percent",
		BasisOutputKind: "POST_DEFENSE_DAMAGE", DefaultEfficiency: &efficiency,
		TargetMatcher:  model.TypeMatcher{All: []string{"combatant/champion"}},
		AbilityMatcher: model.TypeMatcher{Any: []string{"ability/basic_attack", "ability/passive"}},
		DamageMatcher:  model.TypeMatcher{All: []string{"damage_trait/origin_direct"}, Any: []string{"damage_trait/delivery_skill", "damage_trait/delivery_basic_attack"}},
	}}
	for _, entry := range []model.TypeCatalogEntry{
		{Key: "combatant/champion", Domain: "combatant"}, {Key: "ability/passive", Domain: "ability"},
		{Key: "damage_trait/delivery_skill", Domain: "damage_trait"}, {Key: "damage_trait/delivery_basic_attack", Domain: "damage_trait"},
		{Key: "damage_trait/origin_direct", Domain: "damage_trait"},
	} {
		exists := false
		for _, declared := range input.TypeCatalog.Types {
			exists = exists || declared.Key == entry.Key
		}
		if !exists {
			input.TypeCatalog.Types = append(input.TypeCatalog.Types, entry)
		}
	}
	for index := range input.Combatants {
		input.Combatants[index].Types = []string{"combatant/champion"}
	}
	for _, side := range []string{"source", "target"} {
		setCombatantAttr(input, request, side, "life_steal_percent", authoringSlot(rate))
	}
	for providerIndex := range input.SharedProviders {
		for abilityIndex := range input.SharedProviders[providerIndex].Abilities {
			ability := &input.SharedProviders[providerIndex].Abilities[abilityIndex]
			qualifyCadenceVampOperations(ability.Operations, "damage_trait/delivery_basic_attack")
			if ability.TickSpec != nil {
				ability.Types = []string{"ability/passive"}
				qualifyCadenceVampOperations(ability.TickSpec.OnTick, "damage_trait/delivery_skill")
			}
		}
	}
}

func qualifyCadenceVampOperations(operations []model.OperationDefinition, delivery string) {
	for index := range operations {
		operation := &operations[index]
		if operation.Operation == "damage" {
			operation.VampQualification = "RESOLVED"
			operation.Types = []string{delivery, "damage_trait/origin_direct"}
		}
		if operation.SkillHit != nil {
			for candidateIndex := range operation.SkillHit.Candidates {
				qualifyCadenceVampOperations(operation.SkillHit.Candidates[candidateIndex].Operations, delivery)
			}
		}
	}
}

func TestContinuousPeriodicEquipmentFreezesEachSourceVampReceipt(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 1500)
	health := input.Combatants[0].Attributes["hp"]
	health.Current = 500
	setCombatantAttr(&input, &request, "source", "hp", health)
	definition := periodicEquipmentDefinition(5, 500, 1000)
	second := definition.Abilities[0].TickSpec.OnTick[0]
	second.Amount = authoringAmount(authoringConst(15))
	second.Ref = "second_periodic_damage"
	definition.Abilities[0].TickSpec.OnTick = append(definition.Abilities[0].TickSpec.OnTick, second)
	addCadenceEquipment(&input, &request, 0, "periodic", definition)
	periodicSelfVampInputs(&input, &request, .1)
	done := authoringRun(test, input, request)
	if done.Summary.SourceVampHealing == nil || *done.Summary.SourceVampHealing != 6 || *done.Summary.TargetVampHealing != 0 || done.Summary.SourceFinalHp != 506 || done.Summary.SourceDamageDealt != 60 {
		test.Fatal(done.Summary)
	}
	previous := float64(500)
	for _, row := range done.DamageRecords {
		if row["sourceHpBefore"] != previous || row["sourceHpAfter"] != previous+row["postDefenseDamage"].(float64)*.1 {
			test.Fatal("source receipt was not frozen per operation", previous, row)
		}
		previous = row["sourceHpAfter"].(float64)
	}
	if done.AttackRecords[1].SourceHpAfter != 504 || previous != 506 {
		test.Fatal(done.AttackRecords, previous)
	}
	zero := 0
	request.RecordBudget = &model.RecordBudget{MaxDamageRecords: &zero}
	state, failure := newGenericRunState(authoringCompile(test, input), request)
	if failure != nil {
		test.Fatal(failure)
	}
	state.budget.MaxEvidenceItems = 0
	if failure := state.runLoop(); failure != nil {
		test.Fatal(failure)
	}
	truncated := state.buildDoneResult(false)
	if len(truncated.DamageRecords) != 0 || truncated.Summary.SourceVampHealing == nil || *truncated.Summary.SourceVampHealing != 6 || truncated.Summary.SourceFinalHp != 506 || truncated.Summary.SourceDamageDealt != 60 || !truncated.Summary.Execution.Complete {
		test.Fatal(truncated.Summary, truncated.Recording)
	}
}
