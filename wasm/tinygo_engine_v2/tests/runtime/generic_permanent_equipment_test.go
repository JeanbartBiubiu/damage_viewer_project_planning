// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	math "math"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
)

func addPermanentInitializer(input *model.CompileRequest, request *model.RunRequest, actorIndex int, modifiers ...model.ModifierDefinition) {
	addNamedPermanentInitializer(input, request, actorIndex, input.Combatants[actorIndex].Key+"_permanent_equipment", modifiers...)
}

func addNamedPermanentInitializer(input *model.CompileRequest, request *model.RunRequest, actorIndex int, key string, modifiers ...model.ModifierDefinition) {
	owner := input.Combatants[actorIndex].Key
	addFixedEquipment(input, request, actorIndex, key, "hp", 0)
	initializer := model.ProviderDefinition{ProviderKey: key, StableID: key, Kind: "item"}
	for _, modifier := range modifiers {
		definition := key + "_" + modifier.ModifierKey
		input.SharedProviders = append(input.SharedProviders, model.ProviderDefinition{
			ProviderKey: definition, StableID: definition, Kind: "status", Modifiers: []model.ModifierDefinition{modifier},
		})
		initializer.Listeners = append(initializer.Listeners, model.ListenerDefinition{
			ListenerKey: definition, EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSourceInitialized, "event/source_owner"}},
			Operations:          []model.OperationDefinition{{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: definition, ProviderRef: definition}},
			MaxTriggersPerEvent: 1,
		})
	}
	input.SharedProviders = append(input.SharedProviders, initializer)
	input.Combatants[actorIndex].Providers = append(input.Combatants[actorIndex].Providers, model.CombatantProviderMount{ProviderRef: key, DefinitionRef: key})
	request.InitialSnapshot.Combatants[actorIndex].Providers = append(request.InitialSnapshot.Combatants[actorIndex].Providers,
		model.CombatantProviderSnapshot{ProviderRef: key, DefinitionRef: key, Source: owner, Owner: owner, Stacks: 1})
}

func TestPermanentEquipmentBothReceivedAmountsInitializeBeforeFirstOperation(t *testing.T) {
	input, request := sourceInitializationInput()
	request.DriverPlan.BasicAttack = nil
	for actorIndex := range input.Combatants {
		input.Combatants[actorIndex].Attributes["hp"] = model.AttributeSlotDef{Base: 1000, Current: 100, Max: 1000, Resolved: 1000}
		request.InitialSnapshot.Combatants[actorIndex].Attributes["hp"] = input.Combatants[actorIndex].Attributes["hp"]
		addPermanentInitializer(&input, &request, actorIndex,
			model.ModifierDefinition{ModifierKey: "heal_received", Kind: "pipeline", Command: "heal", HealDirection: model.HealReceived,
				HealCategory: model.HealAny, HealGroupKey: "received_heal", HealGroupCalculationMode: model.HealGroupRatioAdd, ValuePolicy: "add_percent", Value: authoringConst(.25)},
			model.ModifierDefinition{ModifierKey: "shield_received", Kind: "pipeline", Command: "shield", Channel: "normal_shield", Stage: "received",
				Bucket: "received_shield", ValuePolicy: "add_percent", Value: authoringConst(.25)})
	}
	input.SharedProviders[0].Abilities = append(input.SharedProviders[0].Abilities, model.AbilityDefinition{
		AbilityKey: "received_amount", Kind: "active", Operations: []model.OperationDefinition{
			{Operation: "heal", Target: "source", Amount: authoringAmount(authoringConst(100))},
			{Operation: "shield", Target: "source", Amount: authoringAmount(authoringConst(100)), ShieldRef: "source_shield"},
			{Operation: "heal", Target: "target", Amount: authoringAmount(authoringConst(100))},
			{Operation: "shield", Target: "target", Amount: authoringAmount(authoringConst(100)), ShieldRef: "target_shield"},
		},
	})
	request.DriverPlan.Entries = []model.DriverEntry{{EntryKey: "received", AbilityRef: "source.provider[attack].ability[received_amount]", Source: "source", Target: "target", FirstAtMs: 0}}
	for repeat := 0; repeat < 2; repeat++ {
		done := authoringRun(t, input, request)
		for _, actor := range done.FinalSnapshot.Combatants {
			actorIndex := 0
			if actor.Key == "target" {
				actorIndex = 1
			}
			if actor.Attributes["hp"].Current != 225 || len(actor.Shields) != 1 || actor.Shields[0].Remaining != 125 || len(actor.Providers) != len(input.Combatants[actorIndex].Providers)+2 {
				t.Fatal(repeat, actor)
			}
		}
	}
}

func TestPermanentAuraProjectsToOpponentAfterEquipmentDerivation(t *testing.T) {
	input, request := sourceInitializationInput()
	request.StopPolicy.DurationMs = 3000
	for key, amount := range map[string]float64{"attack_speed_ratio": .5, "bonus_attack_speed_percent": .2} {
		input.Combatants[0].Attributes[key] = authoringSlot(amount)
		request.InitialSnapshot.Combatants[0].Attributes[key] = authoringSlot(amount)
	}
	addFixedEquipment(&input, &request, 0, "speed_item", "bonus_attack_speed_percent", .1)
	input.Rules.AttributeDerivations = []model.AttributeDerivationDefinition{attackSpeedDerivation("source")}
	addPermanentInitializer(&input, &request, 1, model.ModifierDefinition{ModifierKey: "aura", Kind: "attribute", Target: "opponent.attr.attack_speed", Stage: "total", ValuePolicy: "multiply", Value: authoringConst(.8)})
	for repeat := 0; repeat < 2; repeat++ {
		done := authoringRun(t, input, request)
		if len(done.AttackRecords) != 3 || done.AttackRecords[0].StartAtMs != 0 || done.AttackRecords[1].StartAtMs != 1190 {
			t.Fatal(repeat, done.AttackRecords)
		}
		for _, attack := range done.AttackRecords {
			if math.Abs(attack.AttackSpeed-.84) > 1e-12 {
				t.Fatal(attack)
			}
		}
	}
}

func TestReceivedShieldOnlyChangesNewAmountNotPreviousRemainingOrExpiry(t *testing.T) {
	input, request := loadBasicFixture(t)
	input.SharedProviders = append(input.SharedProviders, model.ProviderDefinition{ProviderKey: "received_shield", StableID: "received_shield", Kind: "status",
		Modifiers: []model.ModifierDefinition{{ModifierKey: "normal_received", Kind: "pipeline", Command: "shield", Channel: "normal_shield", Stage: "received", Bucket: "normal_received", ValuePolicy: "add_percent", Value: authoringConst(.25)}},
	})
	input.Combatants[1].Providers = append(input.Combatants[1].Providers, model.CombatantProviderMount{ProviderRef: "received_shield", DefinitionRef: "received_shield"})
	request.InitialSnapshot.Combatants[1].Providers = append(request.InitialSnapshot.Combatants[1].Providers, model.CombatantProviderSnapshot{
		ProviderRef: "received_shield", DefinitionRef: "received_shield", Source: "target", Owner: "target", Stacks: 1,
	})
	expiry := int64(500)
	request.InitialSnapshot.Combatants[1].Shields = []model.CombatantShieldSnapshot{{ShieldRef: "old", Source: "target", Owner: "target", Remaining: 40, ExpireAt: &expiry, State: map[string]interface{}{}}}
	input.SharedProviders[0].Abilities = []model.AbilityDefinition{{AbilityKey: "new_shield", Kind: "active", Operations: []model.OperationDefinition{
		{Operation: "shield", Target: "target", Amount: authoringAmount(authoringConst(100)), ShieldRef: "new"},
	}}}
	request.DriverPlan.Entries = []model.DriverEntry{{EntryKey: "new_shield", AbilityRef: "source.provider[champion:source_demo].ability[new_shield]", Source: "source", Target: "target", FirstAtMs: 0}}
	request.StopPolicy.DurationMs = 10
	done := authoringRun(t, input, request)
	shields := done.FinalSnapshot.Combatants[1].Shields
	if len(shields) != 2 || shields[0].Remaining != 40 || shields[0].ExpireAt == nil || *shields[0].ExpireAt != 500 || shields[1].Remaining != 125 || shields[1].ExpireAt != nil {
		t.Fatal(shields)
	}
}
