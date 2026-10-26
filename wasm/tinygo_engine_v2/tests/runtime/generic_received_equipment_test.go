// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	math "math"
	reflect "reflect"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
)

const (
	receivedDeliveryBasic   = "damage_trait/delivery_basic_attack"
	receivedOriginDirect    = "damage_trait/origin_direct"
	receivedOriginReflected = "damage_trait/origin_reflected"
)

func receivedEquipmentTypes(input *model.CompileRequest) {
	for _, entry := range []model.TypeCatalogEntry{
		{Key: model.EventTypeBasicAttackReceived, Domain: "event"}, {Key: model.EventTypeDamageTaken, Domain: "event"},
		{Key: model.EventTypeHitLinkApplied, Domain: "event"}, {Key: "event/target_owner", Domain: "event"},
		{Key: "state_scope/provider", Domain: "state_scope"},
		{Key: receivedDeliveryBasic, Domain: "damage_trait"}, {Key: receivedOriginDirect, Domain: "damage_trait"},
		{Key: receivedOriginReflected, Domain: "damage_trait"},
		{Key: "combatant/champion", Domain: "combatant"}, {Key: "ability/passive", Domain: "ability"},
	} {
		declared := false
		for _, current := range input.TypeCatalog.Types {
			declared = declared || current.Key == entry.Key
		}
		if !declared {
			input.TypeCatalog.Types = append(input.TypeCatalog.Types, entry)
		}
	}
}

func TestContinuousReceivedEquipmentBeforeDamageAndFirstVamp(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 100, 0, 0, 1000)
	receivedEquipmentTypes(&input)
	periodicOpponentDefenseInputs(&input, &request)
	for index := range input.Combatants {
		input.Combatants[index].Types = []string{"combatant/champion"}
	}
	setCombatantAttr(&input, &request, "source", "life_steal_percent", authoringSlot(.1))
	request.InitialSnapshot.Combatants[0].Attributes["hp"] = model.AttributeSlotDef{Base: 1000, Max: 1000, Resolved: 1000, Current: 500}
	input.Combatants[0].Attributes["hp"] = request.InitialSnapshot.Combatants[0].Attributes["hp"]
	efficiency := 1.0
	input.Rules.VampRules = []model.VampRuleDefinition{{VampType: model.VampLifeSteal, SourceAttributeKey: "life_steal_percent", BasisOutputKind: model.VampPostDefense, DefaultEfficiency: &efficiency,
		TargetMatcher: model.TypeMatcher{All: []string{"combatant/champion"}}, DamageMatcher: model.TypeMatcher{All: []string{receivedDeliveryBasic, receivedOriginDirect}}, AbilityMatcher: model.TypeMatcher{All: []string{model.AbilityTypeBasicAttack}}}}
	for index := range input.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates {
		if input.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates[index].Operations[0].Operation != "damage" {
			continue
		}
		input.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates[index].Operations[0].Types = []string{receivedDeliveryBasic, receivedOriginDirect}
		input.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates[index].Operations[0].VampQualification = model.VampResolved
	}
	definition := woundProvider("configured_wound", -.4, 3000, model.HealAny, "configured_healing_group")
	definition.StableID = "target_receiver"
	input.SharedProviders = append(input.SharedProviders, definition)
	listener := model.ListenerDefinition{ListenerKey: "received", MaxTriggersPerEvent: 1,
		EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackReceived, "event/target_owner"}},
		Operations: []model.OperationDefinition{
			{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: definition.ProviderKey},
			{Operation: "damage", Target: "target", Ref: "received_damage", Amount: authoringAmount(authoringConst(20)), DamageType: "damage/physics",
				Types: []string{receivedDeliveryBasic, receivedOriginReflected}, VampQualification: model.VampResolved},
		}}
	addCadenceEquipment(&input, &request, 1, "receiver", model.ProviderDefinition{Abilities: []model.AbilityDefinition{{AbilityKey: "react", Kind: "passive_listener", SkillKey: "configured_receiver", Types: []string{"ability/passive"}, ListenerSpec: &listener}}})
	done := authoringRun(test, input, request)
	if !done.Summary.Execution.Complete || done.Summary.BasicAttack.CompletedCount != 2 || done.Summary.TargetDamageDealt != 40 || done.Summary.SourceDamageDealt != 200 || math.Abs(*done.Summary.SourceVampHealing-12) > 1e-9 || math.Abs(done.Summary.SourceFinalHp-472) > 1e-9 {
		test.Fatal(done.Summary)
	}
	for index, row := range done.DamageRecords {
		if index%2 == 0 && (row["owner"] != "target" || row["source"] != "target" || row["target"] != "source") {
			test.Fatal("received reaction was attributed to the attacker", row)
		}
	}
	if repeated := authoringRun(test, input, request); !reflect.DeepEqual(done, repeated) {
		test.Fatal("received fresh runs diverged")
	}
}

func TestContinuousDamageTakenUsesActualReceiverAndOriginalUse(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 1000)
	receivedEquipmentTypes(&input)
	periodicOpponentDefenseInputs(&input, &request)
	addOnHitEquipment(&input, &request, 0, 5)
	listener := model.ListenerDefinition{ListenerKey: "taken", MaxTriggersPerEvent: 1,
		EventMatcher: model.TypeMatcher{All: []string{model.EventTypeDamageTaken, "event/target_owner"}},
		OncePerUse:   &model.OncePerUseLimit{GroupKey: "one_response", Scope: model.OncePerUseScopeProviderTarget},
		Operations: []model.OperationDefinition{{Operation: "damage", Target: "target", Ref: "taken_damage",
			DamageType: "damage/physics", Amount: authoringAmount(authoringConst(7))}}}
	addCadenceEquipment(&input, &request, 1, "receiver", model.ProviderDefinition{Listeners: []model.ListenerDefinition{listener}})
	done := authoringRun(test, input, request)
	if !done.Summary.Execution.Complete || done.Summary.TargetDamageDealt != 14 || done.Summary.SourceDamageDealt != 30 {
		test.Fatal(done.Summary)
	}
	if len(done.FinalSnapshot.UseTriggerLedger) != 2 {
		test.Fatal("damage packets consumed separate attack quotas", done.FinalSnapshot.UseTriggerLedger)
	}
	for _, entry := range done.FinalSnapshot.UseTriggerLedger {
		if entry.Owner != "target" || entry.UseSource != "source" || entry.Target == nil || *entry.Target != "source" {
			test.Fatal(entry)
		}
	}
}

func TestContinuousReceivedAndTakenKeepLegalZeroDamage(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 0, 0, 0, 1000)
	receivedEquipmentTypes(&input)
	listeners := []model.ListenerDefinition{}
	for _, event := range []string{model.EventTypeBasicAttackReceived, model.EventTypeDamageTaken} {
		listeners = append(listeners, model.ListenerDefinition{ListenerKey: event, MaxTriggersPerEvent: 1,
			EventMatcher: model.TypeMatcher{All: []string{event, "event/target_owner"}},
			Operations:   []model.OperationDefinition{cadenceStateOperation(event, "add", 1, nil)}})
	}
	provider := addCadenceEquipment(&input, &request, 1, "receiver", model.ProviderDefinition{
		InitialStateSchema: map[string]interface{}{model.EventTypeBasicAttackReceived: float64(0), model.EventTypeDamageTaken: float64(0)}, Listeners: listeners})
	done := authoringRun(test, input, request)
	if done.Summary.SourceDamageDealt != 0 || cadenceStateValue(test, done, 1, provider, model.EventTypeBasicAttackReceived) != 2 || cadenceStateValue(test, done, 1, provider, model.EventTypeDamageTaken) != 2 {
		test.Fatal(done.Summary, done.FinalSnapshot.Combatants[1])
	}
}

func TestReceivedEquipmentFullyShieldedAttackStillHasBothEvents(test *testing.T) {
	input, request := authoringInput()
	receivedEquipmentTypes(&input)
	request.InitialSnapshot.Combatants[1].Shields = []model.CombatantShieldSnapshot{{ShieldRef: "configured_normal_shield", Source: "target", Owner: "target", Remaining: 1000}}
	listeners := []model.ListenerDefinition{}
	for _, event := range []string{model.EventTypeBasicAttackReceived, model.EventTypeDamageTaken} {
		listeners = append(listeners, model.ListenerDefinition{ListenerKey: event, MaxTriggersPerEvent: 1,
			EventMatcher: model.TypeMatcher{All: []string{event, "event/target_owner"}},
			Operations:   []model.OperationDefinition{cadenceStateOperation(event, "add", 1, nil)}})
	}
	provider := addCadenceEquipment(&input, &request, 1, "shielded_receiver", model.ProviderDefinition{
		InitialStateSchema: map[string]interface{}{model.EventTypeBasicAttackReceived: float64(0), model.EventTypeDamageTaken: float64(0)}, Listeners: listeners})
	done := authoringRun(test, input, request)
	if done.Summary.TargetFinalHp != request.InitialSnapshot.Combatants[1].Attributes["hp"].Current || cadenceStateValue(test, done, 1, provider, model.EventTypeBasicAttackReceived) != 1 || cadenceStateValue(test, done, 1, provider, model.EventTypeDamageTaken) != 1 {
		test.Fatal("shield absorption removed successful receive facts", done.Summary, done.FinalSnapshot.Combatants[1])
	}
}

func TestContinuousReceivedLethalReactionCompletesOriginalHitTail(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 1000)
	receivedEquipmentTypes(&input)
	periodicOpponentDefenseInputs(&input, &request)
	addCadenceEquipment(&input, &request, 1, "lethal_receiver", model.ProviderDefinition{Listeners: []model.ListenerDefinition{{ListenerKey: "react", MaxTriggersPerEvent: 1,
		EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackReceived, "event/target_owner"}},
		Operations:   []model.OperationDefinition{{Operation: "damage", Target: "target", Amount: authoringAmount(authoringConst(1000)), DamageType: "damage/physics"}},
	}}})
	done := authoringRun(test, input, request)
	if done.Summary.StopReason != "source_dead" || done.Summary.SourceDamageDealt != 10 || done.Summary.SourceFinalHp != 0 || done.Summary.BasicAttack.CompletedCount != 1 || !done.Summary.Execution.Complete {
		test.Fatal(done.Summary)
	}
}

func TestContinuousConfiguredHitLinkDoesNotCreateAnotherAttack(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 2000)
	receivedEquipmentTypes(&input)
	input.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates[1].Operations[0].Amount = authoringAmount(authoringConst(0))
	definition := counterEquipmentDefinition(40)
	definition.Listeners[0].Operations[1] = model.OperationDefinition{Operation: model.OperationKindApplyHitLink, Target: "target", Ref: "configured_extra_hit",
		Amount: authoringAmount(authoringConst(1)), Condition: cadenceComparison("hits", "gte", 3)}
	definition.Listeners = append(definition.Listeners, model.ListenerDefinition{ListenerKey: "linked_only", MaxTriggersPerEvent: 1,
		EventMatcher: model.TypeMatcher{All: []string{model.EventTypeHitLinkApplied, "event/source_owner"}},
		Operations:   []model.OperationDefinition{{Operation: "damage", Target: "target", Ref: "configured_extra_damage", Amount: authoringAmount(authoringConst(30)), DamageType: "damage/physics"}},
	})
	addCadenceEquipment(&input, &request, 0, "configured_link", definition)
	done := authoringRun(test, input, request)
	if done.Summary.BasicAttack.StartedCount != 3 || done.Summary.BasicAttack.HitCount != 3 || done.Summary.SourceDamageDealt != 60 || done.AttackRecords[2].PostDefenseDamage != 40 {
		test.Fatal(done.Summary, done.AttackRecords)
	}
}
