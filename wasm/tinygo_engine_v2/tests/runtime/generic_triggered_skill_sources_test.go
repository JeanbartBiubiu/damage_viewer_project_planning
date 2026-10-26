// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	math "math"
	reflect "reflect"
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
)

func discreteSourceField(defaultValue, maximum float64, duration int64) map[string]interface{} {
	field := map[string]interface{}{"valueType": model.ProviderStateValueInteger, "defaultValue": defaultValue,
		"maxValue": maximum, "durationMs": duration}
	if duration > 0 {
		field["refreshPolicy"] = model.ProviderStateRefreshOnWrite
	}
	return field
}

func addTriggeredSkillSource(input *model.CompileRequest, request *model.RunRequest, actor int, key, kind string, definition model.ProviderDefinition) string {
	owner := input.Combatants[actor].Key
	definition.ProviderKey = owner + "_" + key
	definition.StableID = definition.ProviderKey
	definition.Kind = kind
	input.SharedProviders = append(input.SharedProviders, definition)
	input.Combatants[actor].Providers = append(input.Combatants[actor].Providers,
		model.CombatantProviderMount{ProviderRef: definition.ProviderKey, DefinitionRef: definition.ProviderKey})
	request.InitialSnapshot.Combatants[actor].Providers = append(request.InitialSnapshot.Combatants[actor].Providers,
		model.CombatantProviderSnapshot{ProviderRef: definition.ProviderKey, DefinitionRef: definition.ProviderKey, Source: owner, Owner: owner, Stacks: 1})
	return definition.ProviderKey
}

func triggeredSourceInput(duration int64) (model.CompileRequest, model.RunRequest) {
	input, request := continuousAttackInput(1, 10000, 10, 100, 0, duration)
	receivedEquipmentTypes(&input)
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: "state_scope/provider_target", Domain: "state_scope"})
	return input, request
}

func sourceCounterDefinition(event, relation, scope, key string, cap float64, duration int64) model.ProviderDefinition {
	return model.ProviderDefinition{InitialStateSchema: map[string]interface{}{key: discreteSourceField(0, cap, duration)},
		Listeners: []model.ListenerDefinition{{ListenerKey: "count_actual_event", MaxTriggersPerEvent: 1,
			EventMatcher: model.TypeMatcher{All: []string{event, relation}}, Operations: []model.OperationDefinition{{Operation: "state_change",
				Target: "self", Ref: key, Types: []string{scope}, ValuePolicy: "add", Amount: authoringAmount(authoringConst(1))}}}}}
}

func enableSourceSpeedDerivation(input *model.CompileRequest, request *model.RunRequest, speed float64) {
	for key, value := range map[string]float64{"attack_speed": speed, "attack_speed_ratio": speed, "bonus_attack_speed_percent": 0} {
		input.Combatants[0].Attributes[key] = authoringSlot(value)
		request.InitialSnapshot.Combatants[0].Attributes[key] = authoringSlot(value)
	}
	input.Rules.AttributeDerivations = []model.AttributeDerivationDefinition{attackSpeedDerivation("source")}
	request.DriverPlan.BasicAttack.AttackSpeedInputMax = 10
}

func targetCounterValue(test *testing.T, snapshot model.Snapshot, actor int, ref, key, target string) float64 {
	test.Helper()
	bag, exists := snapshot.Combatants[actor].ProviderState[ref].(map[string]interface{})
	if !exists {
		test.Fatal("missing counter", snapshot.Combatants[actor].ProviderState)
	}
	state, exists := bag["targetState"].(map[string]interface{})
	if !exists || state["target"] != target {
		test.Fatal("incorrect target ownership", bag)
	}
	return state["values"].(map[string]interface{})[key].(float64)
}

func TestTriggeredSkillSourcesSeparateStartHitLinksAndReceiving(test *testing.T) {
	input, request := triggeredSourceInput(2000)
	refs := map[string]string{}
	for _, event := range []string{model.EventTypeBasicAttackStart, model.EventTypeBasicAttackHit, model.EventTypeAttackLinkApplied, model.EventTypeHitLinkApplied} {
		refs[event] = addTriggeredSkillSource(&input, &request, 0, "counter_"+event, "character",
			sourceCounterDefinition(event, "event/source_owner", "state_scope/provider", "count", 99, 0))
	}
	addTriggeredSkillSource(&input, &request, 1, "idle_hit", "character",
		sourceCounterDefinition(model.EventTypeBasicAttackHit, "event/source_owner", "state_scope/provider", "count", 99, 0))
	received := addTriggeredSkillSource(&input, &request, 1, "receiver", "build",
		sourceCounterDefinition(model.EventTypeBasicAttackReceived, "event/target_owner", "state_scope/provider_target", "count", 99, 0))
	damageTaken := addTriggeredSkillSource(&input, &request, 1, "damage_receiver", "character",
		sourceCounterDefinition(model.EventTypeDamageTaken, "event/target_owner", "state_scope/provider_target", "count", 99, 0))
	addTriggeredSkillSource(&input, &request, 0, "additional_link", "build", model.ProviderDefinition{
		Listeners: []model.ListenerDefinition{{ListenerKey: "extend_real_hit", MaxTriggersPerEvent: 1,
			EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackHit, "event/source_owner"}}, Operations: []model.OperationDefinition{
				{Operation: model.OperationKindApplyHitLink, Target: "target", Amount: authoringAmount(authoringConst(1))},
			}}}})
	addOnHitEquipment(&input, &request, 0, 25)
	done := authoringRun(test, input, request)
	if !done.Summary.Execution.Complete || done.Summary.BasicAttack.CompletedCount != 3 || done.Summary.TargetDamageDealt != 0 {
		test.Fatal(done.Summary)
	}
	for event, ref := range refs {
		expected := float64(3)
		if event == model.EventTypeHitLinkApplied {
			expected = 6
		}
		if cadenceStateValue(test, done, 0, ref, "count") != expected {
			test.Fatal(done.FinalSnapshot.Combatants)
		}
	}
	if targetCounterValue(test, done.FinalSnapshot, 1, received, "count", "source") != 3 {
		test.Fatal(done.FinalSnapshot)
	}
	if targetCounterValue(test, done.FinalSnapshot, 1, damageTaken, "count", "source") != 6 {
		test.Fatal("damage packets were mixed with actual received attacks", done.FinalSnapshot)
	}
	uses := map[string]bool{}
	for _, attack := range done.AttackRecords {
		uses[attack.UseRef] = true
	}
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindEmittedEvent && (item.Ref == model.EventTypeHitLinkApplied || item.Ref == model.EventTypeAttackLinkApplied) {
			use, present := item.Data["useRef"].(string)
			if !present || !uses[use] {
				test.Fatal("linked event lost its original attack identity", item)
			}
		}
	}
	if _, changed := done.FinalSnapshot.Combatants[1].ProviderState["target_idle_hit"]; changed {
		test.Fatal("idle side counted another actor's hit")
	}
	if repeated := authoringRun(test, input, request); !reflect.DeepEqual(done, repeated) {
		test.Fatal("fresh source state leaked across runs")
	}
}

func TestTriggeredSkillSourceStartWaitUsesFullCappedFormula(test *testing.T) {
	input, request := triggeredSourceInput(1000)
	enableSourceSpeedDerivation(&input, &request, 1)
	definition := sourceCounterDefinition(model.EventTypeBasicAttackStart, "event/source_owner", "state_scope/provider", "layers", 4, 2500)
	definition.Modifiers = []model.ModifierDefinition{{ModifierKey: "layer_speed", Kind: "attribute", Target: "self.attr.bonus_attack_speed_percent",
		ValuePolicy: "add", Value: authoringRead("provider.state.layers")}}
	ref := addTriggeredSkillSource(&input, &request, 0, "layered_start", "character", definition)
	input.SharedProviders[0].Processes[0].Cooldown.DurationMs = authoringBinary("div", authoringConst(1000),
		authoringBinary("min", authoringRead("source.attr.attack_speed.resolved"), authoringConst(1.5)))
	done := authoringRun(test, input, request)
	if len(done.AttackRecords) != 2 || done.AttackRecords[1].StartAtMs != 667 || *done.AttackRecords[0].ReadyAtMs != 1000 || *done.AttackRecords[0].FinalReadyAtMs != 667 || cadenceStateValue(test, done, 0, ref, "layers") != 2 {
		test.Fatal(done.AttackRecords, done.FinalSnapshot)
	}
	if len(done.FinalSnapshot.ProcessInstances) != 2 {
		test.Fatal("start trigger restarted the actual process", done.FinalSnapshot.ProcessInstances)
	}
}

func TestTriggeredSkillSourceStartWaitTracksNonSpeedDependency(test *testing.T) {
	input, request := triggeredSourceInput(1500)
	definition := sourceCounterDefinition(model.EventTypeBasicAttackStart, "event/source_owner", "state_scope/provider", "layers", 4, 0)
	definition.Modifiers = []model.ModifierDefinition{{ModifierKey: "layer_damage", Kind: "attribute", Target: "self.attr.attack_damage",
		ValuePolicy: "add", Value: authoringBinary("mul", authoringRead("provider.state.layers"), authoringConst(10))}}
	addTriggeredSkillSource(&input, &request, 0, "non_speed_start", "build", definition)
	input.SharedProviders[0].Processes[0].Cooldown.DurationMs = authoringBinary("add", authoringConst(1000),
		authoringBinary("mul", authoringRead("source.attr.attack_damage.resolved"), authoringConst(20)))
	done := authoringRun(test, input, request)
	if len(done.AttackRecords) != 2 || *done.AttackRecords[0].ReadyAtMs != 1200 || *done.AttackRecords[0].FinalReadyAtMs != 1400 || done.AttackRecords[1].StartAtMs != 1400 || done.AttackRecords[0].AttackSpeed != 1 {
		test.Fatal(done.AttackRecords)
	}
}

func TestTriggeredSkillSourceLayersCapRefreshAndExpireAsWhole(test *testing.T) {
	for _, scenario := range []struct {
		speed    float64
		duration int64
		layers   float64
	}{{1, 2700, 4}, {.2, 3000, 0}} {
		input, request := triggeredSourceInput(scenario.duration)
		enableSourceSpeedDerivation(&input, &request, scenario.speed)
		definition := sourceCounterDefinition(model.EventTypeBasicAttackStart, "event/source_owner", "state_scope/provider", "layers", 4, 2500)
		definition.Modifiers = []model.ModifierDefinition{{ModifierKey: "speed", Kind: "attribute", Target: "self.attr.bonus_attack_speed_percent",
			ValuePolicy: "add", Value: authoringBinary("mul", authoringRead("provider.state.layers"), authoringConst(.25))}}
		ref := addTriggeredSkillSource(&input, &request, 0, "whole_expiry", "character", definition)
		done := authoringRun(test, input, request)
		if cadenceStateValue(test, done, 0, ref, "layers") != scenario.layers || !done.Summary.Execution.Complete {
			test.Fatal(scenario, done.Summary, done.FinalSnapshot)
		}
		if scenario.layers == 0 && (done.Summary.BasicAttack.CompletedCount != 1 || done.FinalSnapshot.Combatants[0].Attributes["attack_speed"].Resolved != .2 || *done.AttackRecords[0].FinalReadyAtMs != 4375) {
			test.Fatal(done.AttackRecords, done.FinalSnapshot)
		}
	}
}

func pairedCounterSourceInput(duration int64) (model.CompileRequest, model.RunRequest, string, string, string) {
	input, request := triggeredSourceInput(duration)
	input.Combatants[0].Attributes["attack_damage"] = authoringSlot(100)
	request.InitialSnapshot.Combatants[0].Attributes["attack_damage"] = authoringSlot(100)
	enableSourceSpeedDerivation(&input, &request, 1)
	root := "source_paired_counter"
	armor, speed := root+"_armor", root+"_speed"
	input.SharedProviders = append(input.SharedProviders,
		model.ProviderDefinition{ProviderKey: armor, Kind: "status", StableID: root, Lifecycle: sourceTargetLifecycle(1200),
			Modifiers: []model.ModifierDefinition{{ModifierKey: "recipient_armor", Kind: "attribute", Target: "self.attr.armor", ValuePolicy: "add_percent", Value: authoringConst(-.2)}}},
		model.ProviderDefinition{ProviderKey: speed, Kind: "status", StableID: root, Lifecycle: sourceTargetLifecycle(700),
			Modifiers: []model.ModifierDefinition{{ModifierKey: "owned_speed", Kind: "attribute", Target: "self.attr.bonus_attack_speed_percent", ValuePolicy: "add", Value: authoringConst(.5)}}})
	definition := sourceCounterDefinition(model.EventTypeBasicAttackHit, "event/source_owner", "state_scope/provider_target", "count", 3, 1500)
	qualified := p6Gte("provider.target_state.count", 3)
	definition.Listeners[0].Operations = append(definition.Listeners[0].Operations,
		model.OperationDefinition{Operation: "damage", Target: "target", DamageType: "damage/physics", Amount: authoringAmount(authoringConst(30)), Condition: qualified},
		model.OperationDefinition{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: armor, Condition: qualified},
		model.OperationDefinition{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: speed, Condition: qualified},
		model.OperationDefinition{Operation: "state_change", Target: "self", Ref: "count", Types: []string{"state_scope/provider_target"},
			ValuePolicy: "override", Amount: authoringAmount(authoringConst(0)), Condition: qualified})
	ref := addTriggeredSkillSource(&input, &request, 0, "paired_counter", "character", definition)
	return input, request, ref, armor, speed
}

func TestTriggeredSkillSourcePairedCounterAppliesRecipientArmorAndOwnedSpeed(test *testing.T) {
	input, request, ref, _, _ := pairedCounterSourceInput(3300)
	done := authoringRun(test, input, request)
	if !done.Summary.Execution.Complete || done.Summary.BasicAttack.CompletedCount != 4 || done.AttackRecords[3].StartAtMs != 2667 || math.Abs(done.Summary.SourceDamageDealt-(165+100/1.8)) > 1e-9 {
		test.Fatal(done.Summary, done.AttackRecords)
	}
	if done.FinalSnapshot.Combatants[1].Attributes["armor"].Resolved != 100 || done.FinalSnapshot.Combatants[0].Attributes["attack_speed"].Resolved != 1 || targetCounterValue(test, done.FinalSnapshot, 0, ref, "count", "target") != 1 {
		test.Fatal("attribute expiry or counter ownership is incorrect", done.FinalSnapshot)
	}
}

func TestTriggeredSkillSourceRecipientPercentAdditionUsesPipelineBase(test *testing.T) {
	input, request, _, _, _ := pairedCounterSourceInput(2600)
	addFixedEquipment(&input, &request, 1, "armor_contribution", "armor", 25)
	done := authoringRun(test, input, request)
	if done.FinalSnapshot.Combatants[1].Attributes["armor"].Base != 100 || done.FinalSnapshot.Combatants[1].Attributes["armor"].Resolved != 105 {
		test.Fatal("ordinary percent addition must retain the existing pipeline base semantics", done.FinalSnapshot)
	}
}

func TestTriggeredSkillSourceRejectsUnknownRecipientAttributeAndHP(test *testing.T) {
	for _, target := range []string{"self.attr.hp", "self.attr.unknown", "opponent.attr.armor", "source.attr.armor"} {
		input, request, _, armor, _ := pairedCounterSourceInput(100)
		for index := range input.SharedProviders {
			if input.SharedProviders[index].ProviderKey == armor {
				input.SharedProviders[index].Modifiers[0].Target = target
			}
		}
		if _, err := runtimeengine.RunGeneric(authoringCompile(test, input), request); err == nil {
			test.Fatal("unsupported recipient attribute admitted", target)
		}
	}
}

func TestTriggeredSkillSourceRejectsUnownedAndIncompleteGraphs(test *testing.T) {
	for _, boundary := range []string{"owner_identity", "missing_field", "extra_process", "foreign_root_event", "active_ability", "recursive_link"} {
		input, request, root, _, _ := pairedCounterSourceInput(100)
		for index := range input.SharedProviders {
			definition := &input.SharedProviders[index]
			if definition.ProviderKey != root {
				continue
			}
			switch boundary {
			case "owner_identity":
				definition.StableID = "another_source"
			case "missing_field":
				delete(definition.InitialStateSchema, "count")
			case "extra_process":
				definition.Listeners[0].AbilityRef = authoringRef("initial")
			case "foreign_root_event":
				input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: "event/unadmitted_root", Domain: "event"})
				definition.Listeners[0].EventMatcher.All[0] = "event/unadmitted_root"
			case "active_ability":
				definition.Abilities = []model.AbilityDefinition{{AbilityKey: "unexpected_active", Kind: "active"}}
			case "recursive_link":
				definition.Listeners[0].EventMatcher.All[0] = model.EventTypeHitLinkApplied
				definition.Listeners[0].Operations = []model.OperationDefinition{{Operation: model.OperationKindApplyHitLink, Target: "target", Amount: authoringAmount(authoringConst(1))}}
			}
		}
		result := compilebundle.CompileGeneric(input)
		if result.OK {
			if _, err := runtimeengine.RunGeneric(result.Session, request); err == nil {
				test.Fatal("unsupported source graph admitted", boundary)
			}
		}
	}
}
