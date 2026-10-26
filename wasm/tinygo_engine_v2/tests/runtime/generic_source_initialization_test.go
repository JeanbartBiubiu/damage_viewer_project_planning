// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	testing "testing"
	model "tinygo_engine_v2/internal/model"
)

func sourceInitializationInput() (model.CompileRequest, model.RunRequest) {
	input, request := continuousAttackInput(1, 1000, 100, 0, 0, 1000)
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: model.EventTypeSourceInitialized, Domain: "event"})
	return input, request
}

func TestSourceInitializationCompletesBeforeFirstNativeAttack(t *testing.T) {
	input, request := sourceInitializationInput()
	done := authoringRun(t, input, request)
	if len(done.AttackRecords) != 2 || done.AttackRecords[0].StartAtMs != 0 {
		t.Fatal(done.AttackRecords)
	}
	initialized := map[string]int{}
	for _, evidence := range done.Evidence.Items {
		if evidence.Kind == "source_initialized" {
			initialized[evidence.Ref]++
			if evidence.TimeMs != 0 || evidence.Data["eventSource"] != evidence.Ref || evidence.Data["currentTarget"] != evidence.Ref {
				t.Fatal(evidence)
			}
		}
	}
	if initialized["source"] != 1 || initialized["target"] != 1 {
		t.Fatal(initialized)
	}
}

func TestSourceInitializationEventBudgetPreventsFirstAttack(t *testing.T) {
	input, request := sourceInitializationInput()
	request.SafetyBudget = &model.RunSafetyBudget{MaxEvents: 1}
	done := authoringRun(t, input, request)
	if len(done.AttackRecords) != 0 || done.Summary.Execution.Complete || done.Summary.Execution.BudgetCause == nil || *done.Summary.Execution.BudgetCause != model.BudgetCauseMaxEvents {
		t.Fatal(done.Summary, done.AttackRecords)
	}
}

func TestSourceInitializationCurrentTargetStaysSelfAcrossRepeatedRuns(t *testing.T) {
	input, request := sourceInitializationInput()
	request.DriverPlan.BasicAttack = nil
	for actorIndex := range input.Combatants {
		key := input.Combatants[actorIndex].Key
		input.Combatants[actorIndex].Attributes["init_count"] = authoringSlot(0)
		request.InitialSnapshot.Combatants[actorIndex].Attributes["init_count"] = authoringSlot(0)
		providerKey := key + "_initializer"
		input.SharedProviders = append(input.SharedProviders, model.ProviderDefinition{
			ProviderKey: providerKey, StableID: providerKey, Kind: "generic",
			Listeners: []model.ListenerDefinition{{ListenerKey: providerKey + "_ready",
				EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSourceInitialized, "event/source_owner"}},
				Operations: []model.OperationDefinition{{Operation: "attribute_change", Target: "target", AttributeKey: "init_count",
					ValuePolicy: "add", Amount: authoringAmount(authoringConst(1))}},
			}},
		})
		input.Combatants[actorIndex].Providers = append(input.Combatants[actorIndex].Providers, model.CombatantProviderMount{ProviderRef: providerKey, DefinitionRef: providerKey})
		request.InitialSnapshot.Combatants[actorIndex].Providers = append(request.InitialSnapshot.Combatants[actorIndex].Providers,
			model.CombatantProviderSnapshot{ProviderRef: providerKey, DefinitionRef: providerKey, Source: key, Owner: key, Stacks: 1})
	}
	for repeat := 0; repeat < 2; repeat++ {
		done := authoringRun(t, input, request)
		for _, actor := range done.FinalSnapshot.Combatants {
			if actor.Attributes["init_count"].Resolved != 1 {
				t.Fatal(repeat, actor.Key, actor.Attributes["init_count"])
			}
		}
	}
}
