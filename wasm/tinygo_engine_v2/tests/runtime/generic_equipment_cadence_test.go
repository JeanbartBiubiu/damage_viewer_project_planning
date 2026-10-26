// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	reflect "reflect"
	strconv "strconv"
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

func cadenceComparison(key, operator string, value float64) *model.GenericFormulaExpr {
	return &model.GenericFormulaExpr{Op: operator, Args: []model.GenericFormulaExpr{
		{Op: "read", Path: "provider.state." + key}, authoringConst(value),
	}}
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

func counterEquipmentDefinition(amount float64) model.ProviderDefinition {
	threshold := cadenceComparison("hits", "gte", 3)
	return model.ProviderDefinition{InitialStateSchema: map[string]interface{}{"hits": float64(0)},
		Listeners: []model.ListenerDefinition{{ListenerKey: "counter", MaxTriggersPerEvent: 1,
			EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackHit, "event/source_owner"}},
			Operations: []model.OperationDefinition{
				cadenceStateOperation("hits", "add", 1, nil),
				{Operation: "damage", Target: "target", Ref: "cadence_damage", DamageType: "damage/physics",
					Amount: authoringAmount(authoringConst(amount)), Condition: threshold},
				cadenceStateOperation("hits", "override", 0, threshold),
			},
		}},
	}
}

func TestContinuousEquipmentCounterCountsNativeHitsNotDamagePackets(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 5000)
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: "state_scope/provider", Domain: "state_scope"})
	addOnHitEquipment(&input, &request, 0, 25)
	sourceProvider := addCadenceEquipment(&input, &request, 0, "counter", counterEquipmentDefinition(40))
	targetProvider := addCadenceEquipment(&input, &request, 1, "counter", counterEquipmentDefinition(900))
	done := authoringRun(test, input, request)
	if !done.Summary.Execution.Complete || done.Summary.BasicAttack.CompletedCount != 6 || done.Summary.SourceDamageDealt != 290 || done.Summary.TargetDamageDealt != 0 || done.Recording.DamageRecordCount != 14 {
		test.Fatal(done.Summary, done.Recording)
	}
	for index, attack := range done.AttackRecords {
		expected := float64(35)
		if (index+1)%3 == 0 {
			expected += 40
		}
		if attack.PostDefenseDamage != expected || attack.ActualHpLoss != expected {
			test.Fatal(index, attack)
		}
	}
	if cadenceStateValue(test, done, 0, sourceProvider, "hits") != 0 {
		test.Fatal(done.FinalSnapshot.Combatants)
	}
	if _, written := done.FinalSnapshot.Combatants[1].ProviderState[targetProvider]; written {
		test.Fatal("idle opponent acquired a mutated counter", done.FinalSnapshot.Combatants[1].ProviderState)
	}
	if repeated := authoringRun(test, input, request); !reflect.DeepEqual(done, repeated) {
		test.Fatal("fresh runs diverged")
	}
	zero := 0
	request.RecordBudget = &model.RecordBudget{MaxAttackRecords: &zero, MaxDamageRecords: &zero}
	truncated := authoringRun(test, input, request)
	if truncated.Summary.SourceDamageDealt != done.Summary.SourceDamageDealt || truncated.Recording.DamageRecordCount != done.Recording.DamageRecordCount || len(truncated.AttackRecords)+len(truncated.DamageRecords) != 0 || cadenceStateValue(test, truncated, 0, sourceProvider, "hits") != 0 {
		test.Fatal(truncated.Summary, truncated.Recording)
	}
}

func TestContinuousEquipmentCounterConsumptionAndOwnerIsolation(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 3000)
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: "state_scope/provider", Domain: "state_scope"})
	first := addCadenceEquipment(&input, &request, 0, "counter_one", counterEquipmentDefinition(40))
	second := addCadenceEquipment(&input, &request, 0, "counter_two", counterEquipmentDefinition(70))
	done := authoringRun(test, input, request)
	if done.Summary.SourceDamageDealt != 150 || cadenceStateValue(test, done, 0, first, "hits") != 1 || cadenceStateValue(test, done, 0, second, "hits") != 1 {
		test.Fatal(done.Summary, done.FinalSnapshot.Combatants)
	}
}

func cooldownEquipmentDefinition(duration int64) model.ProviderDefinition {
	ready := cadenceComparison("blocked", "eq", 0)
	return model.ProviderDefinition{InitialStateSchema: map[string]interface{}{"blocked": map[string]interface{}{
		"defaultValue": float64(0), "maxValue": float64(1), "durationMs": float64(duration), "refreshPolicy": model.ProviderStateRefreshOnWrite,
	}}, Listeners: []model.ListenerDefinition{{ListenerKey: "cooldown", MaxTriggersPerEvent: 1,
		EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackHit, "event/source_owner"}},
		Operations: []model.OperationDefinition{
			{Operation: "damage", Target: "target", Ref: "cooldown_damage", DamageType: "damage/physics",
				Amount: authoringAmount(authoringConst(25)), Condition: ready},
			cadenceStateOperation("blocked", "override", 1, ready),
		},
	}}}
}

func TestContinuousEquipmentCooldownBeforeAtAndAfterReady(test *testing.T) {
	for _, scenario := range []struct {
		duration int64
		procs    int
	}{{999, 3}, {1000, 3}, {1001, 2}, {1500, 2}} {
		test.Run("cooldown_"+strconv.FormatInt(scenario.duration, 10), func(test *testing.T) {
			input, request := continuousAttackInput(1, 10000, 10, 0, 0, 2000)
			input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: "state_scope/provider", Domain: "state_scope"})
			addOnHitEquipment(&input, &request, 0, 5)
			provider := addCadenceEquipment(&input, &request, 0, "cooldown", cooldownEquipmentDefinition(scenario.duration))
			done := authoringRun(test, input, request)
			if !done.Summary.Execution.Complete || done.Summary.BasicAttack.CompletedCount != 3 || done.Summary.SourceDamageDealt != 45+float64(scenario.procs)*25 || done.Recording.DamageRecordCount != 6+scenario.procs || cadenceStateValue(test, done, 0, provider, "blocked") != 1 {
				test.Fatal(scenario, done.Summary, done.Recording)
			}
		})
	}
}
