// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
)

func addAttackCounter(input *model.CompileRequest, request *model.RunRequest, initial float64, ref string) {
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: "state_scope/provider", Domain: "state_scope"})
	read := authoringRead("use.provider_state_before.hits")
	condition := func(op string) *model.GenericFormulaExpr {
		return authoringAmount(authoringBinary(op, read, authoringConst(2)))
	}
	listener := func(key, event string, test *model.GenericFormulaExpr, operations ...model.OperationDefinition) model.AbilityDefinition {
		return model.AbilityDefinition{AbilityKey: key, Kind: "passive_listener", SkillKey: "counter", ListenerSpec: &model.ListenerDefinition{
			ListenerKey: key, EventMatcher: model.TypeMatcher{All: []string{event, "event/source_owner"}}, Condition: test, Operations: operations}}
	}
	change := func(policy string, amount float64) model.OperationDefinition {
		return model.OperationDefinition{Operation: "state_change", Target: "self", Ref: "hits", ValuePolicy: policy, Types: []string{"state_scope/provider"}, Amount: authoringAmount(authoringConst(amount))}
	}
	provider := model.ProviderDefinition{ProviderKey: ref, SkillKey: "counter", Kind: "character", StableID: ref,
		InitialStateSchema: map[string]interface{}{"hits": map[string]interface{}{"valueType": "integer", "defaultValue": initial, "maxValue": 2, "durationMs": 0}},
		Abilities: []model.AbilityDefinition{
			listener("consume", model.EventTypeBasicAttackStart, condition("eq"), change("set", 0)),
			listener("stack", model.EventTypeBasicAttackHit, condition("lt"), change("add", 1)),
			listener("bonus", model.EventTypeBasicAttackHit, condition("eq"), model.OperationDefinition{Operation: "damage", Target: "target", Ref: ref + "_bonus", DamageType: "damage/physics", Amount: authoringAmount(authoringConst(5))}),
		}}
	input.SharedProviders = append(input.SharedProviders, provider)
	input.Combatants[0].Providers = append(input.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: ref, DefinitionRef: ref})
	request.InitialSnapshot.Combatants[0].Providers = append(request.InitialSnapshot.Combatants[0].Providers, model.CombatantProviderSnapshot{ProviderRef: ref, DefinitionRef: ref, Source: "source", Owner: "source", Stacks: 1})
}

func TestAttackStartCounterRejectsForeignAndNonIntegerReads(t *testing.T) {
	for _, scenario := range []string{"unknown", "decimal", "target", "no_owner", "skill_event", "amount"} {
		t.Run(scenario, func(t *testing.T) {
			input, request := continuousAttackInput(1, 10000, 100, 0, 0, 1)
			addAttackCounter(&input, &request, 2, "counter_a")
			provider := &input.SharedProviders[1]
			switch scenario {
			case "unknown":
				provider.Abilities[0].ListenerSpec.Condition = authoringAmount(authoringRead("use.provider_state_before.other"))
			case "decimal":
				provider.InitialStateSchema["hits"].(map[string]interface{})["valueType"] = "number"
			case "target":
				input.Combatants[1].Providers = input.Combatants[0].Providers[1:]
				input.Combatants[0].Providers = input.Combatants[0].Providers[:1]
			case "no_owner":
				provider.Abilities[0].ListenerSpec.EventMatcher.All = []string{model.EventTypeBasicAttackStart}
			case "skill_event":
				provider.Abilities[0].ListenerSpec.EventMatcher.All = []string{model.EventTypeHitLinkApplied, "event/source_owner"}
			case "amount":
				provider.Abilities[0].ListenerSpec.Operations[0].Amount = authoringAmount(authoringRead("use.provider_state_before.hits"))
			}
			if result := compilebundle.CompileGeneric(input); result.OK {
				t.Fatal("invalid capability compiled", scenario)
			}
		})
	}
}
