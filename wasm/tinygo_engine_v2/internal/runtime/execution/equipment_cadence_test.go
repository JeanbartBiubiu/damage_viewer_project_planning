package execution

import (
	testing "testing"
	model "tinygo_engine_v2/internal/model"
)

func addCadenceEquipment(input *model.CompileRequest, request *model.RunRequest, actorIndex int, key string, definition model.ProviderDefinition) string {
	owner := input.Combatants[actorIndex].Key
	key = owner + "_" + key
	addFixedEquipment(input, request, actorIndex, key, "hp", 0)
	definition.ProviderKey = key + "_passive"
	definition.StableID = key
	definition.Kind = "item"
	input.SharedProviders = append(input.SharedProviders, definition)
	input.Combatants[actorIndex].Providers = append(input.Combatants[actorIndex].Providers,
		model.CombatantProviderMount{ProviderRef: definition.ProviderKey, DefinitionRef: definition.ProviderKey})
	request.InitialSnapshot.Combatants[actorIndex].Providers = append(request.InitialSnapshot.Combatants[actorIndex].Providers,
		model.CombatantProviderSnapshot{ProviderRef: definition.ProviderKey, DefinitionRef: definition.ProviderKey, Source: owner, Owner: owner, Stacks: 1})
	return definition.ProviderKey
}

func cadenceStateOperation(key, policy string, value float64, condition *model.GenericFormulaExpr) model.OperationDefinition {
	return model.OperationDefinition{Operation: "state_change", Target: "self", Ref: key,
		Types: []string{"state_scope/provider"}, ValuePolicy: policy, Amount: authoringAmount(authoringConst(value)), Condition: condition}
}

func cadenceStateValue(test *testing.T, done model.DoneResult, actorIndex int, provider, key string) float64 {
	test.Helper()
	bag, exists := done.FinalSnapshot.Combatants[actorIndex].ProviderState[provider].(map[string]interface{})
	if !exists {
		test.Fatal("missing owned state", done.FinalSnapshot.Combatants[actorIndex].ProviderState)
	}
	values, exists := bag["state"].(map[string]interface{})
	if !exists {
		test.Fatal("missing state values", bag)
	}
	value, exists := values[key].(float64)
	if !exists {
		test.Fatal("missing cadence field", values)
	}
	return value
}
