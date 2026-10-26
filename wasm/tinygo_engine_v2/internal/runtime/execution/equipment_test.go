package execution

import (
	model "tinygo_engine_v2/internal/model"
)

func attackSpeedDerivation(owner string) model.AttributeDerivationDefinition {
	read := func(key, field string) model.GenericFormulaExpr {
		return model.GenericFormulaExpr{Op: "read", Path: owner + ".attr." + key + "." + field}
	}
	return model.AttributeDerivationDefinition{ValuePolicy: "set", ValueType: "DECIMAL", CombatantKey: owner, AttributeKey: "attack_speed", Value: model.GenericFormulaExpr{Op: "add", Args: []model.GenericFormulaExpr{
		read("attack_speed", "base"), {Op: "mul", Args: []model.GenericFormulaExpr{
			read("attack_speed_ratio", "resolved"), {Op: "sub", Args: []model.GenericFormulaExpr{read("bonus_attack_speed_percent", "resolved"), read("bonus_attack_speed_percent", "base")}},
		}},
	}}}
}

func addFixedEquipment(input *model.CompileRequest, request *model.RunRequest, actorIndex int, key, attributeKey string, amount float64) {
	owner := input.Combatants[actorIndex].Key
	providerKey := owner + "_" + key
	input.SharedProviders = append(input.SharedProviders, model.ProviderDefinition{
		ProviderKey: providerKey, Kind: "item", StableID: key,
		Modifiers: []model.ModifierDefinition{{ModifierKey: providerKey + "_" + attributeKey,
			Kind: "attribute", Target: "self.attr." + attributeKey, ValuePolicy: "add", Value: model.GenericFormulaExpr{Op: "const", Value: &amount}}},
	})
	input.Combatants[actorIndex].Providers = append([]model.CombatantProviderMount{{ProviderRef: providerKey, DefinitionRef: providerKey}}, input.Combatants[actorIndex].Providers...)
	request.InitialSnapshot.Combatants[actorIndex].Providers = append([]model.CombatantProviderSnapshot{{
		ProviderRef: providerKey, DefinitionRef: providerKey, Source: owner, Owner: owner, Stacks: 1,
	}}, request.InitialSnapshot.Combatants[actorIndex].Providers...)
}
