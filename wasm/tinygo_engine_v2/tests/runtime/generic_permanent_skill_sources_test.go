// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	math "math"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
)

func addPermanentSkillSource(input *model.CompileRequest, request *model.RunRequest, actorIndex int, key, kind string, modifier model.ModifierDefinition) {
	owner := input.Combatants[actorIndex].Key
	effectKey := key + "_effect"
	input.SharedProviders = append(input.SharedProviders,
		model.ProviderDefinition{ProviderKey: effectKey, StableID: effectKey, Kind: "status", Modifiers: []model.ModifierDefinition{modifier}},
		model.ProviderDefinition{ProviderKey: key, StableID: key, Kind: kind, Listeners: []model.ListenerDefinition{
			{ListenerKey: "initialize", EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSourceInitialized, "event/source_owner"}},
				MaxTriggersPerEvent: 1, Operations: []model.OperationDefinition{
					{Operation: "apply_provider", Target: "self", ProviderRef: effectKey, ProviderDefinitionRef: effectKey},
				}},
		}})
	input.Combatants[actorIndex].Providers = append(input.Combatants[actorIndex].Providers,
		model.CombatantProviderMount{ProviderRef: key, DefinitionRef: key})
	request.InitialSnapshot.Combatants[actorIndex].Providers = append(request.InitialSnapshot.Combatants[actorIndex].Providers,
		model.CombatantProviderSnapshot{ProviderRef: key, DefinitionRef: key, Source: owner, Owner: owner, Stacks: 1})
}

func TestPermanentCharacterAndBuildSourcesInitializeBeforeFirstAttack(t *testing.T) {
	input, request := sourceInitializationInput()
	request.StopPolicy.DurationMs = 2000
	request.DriverPlan.BasicAttack.AttackSpeedInputMax = 5
	for key, value := range map[string]float64{"attack_speed_ratio": .5, "bonus_attack_speed_percent": 0} {
		input.Combatants[0].Attributes[key] = authoringSlot(value)
		request.InitialSnapshot.Combatants[0].Attributes[key] = authoringSlot(value)
	}
	input.Rules.AttributeDerivations = []model.AttributeDerivationDefinition{attackSpeedDerivation("source")}
	addPermanentSkillSource(&input, &request, 0, "character_constant", "character", model.ModifierDefinition{
		ModifierKey: "extra_speed", Kind: "attribute", Target: "self.attr.bonus_attack_speed_percent", ValuePolicy: "add", Value: authoringConst(.15)})
	addPermanentSkillSource(&input, &request, 0, "build_constant", "build", model.ModifierDefinition{
		ModifierKey: "extra_speed", Kind: "attribute", Target: "self.attr.bonus_attack_speed_percent", ValuePolicy: "add", Value: authoringConst(.1)})
	for repeat := 0; repeat < 3; repeat++ {
		done := authoringRun(t, input, request)
		if len(done.AttackRecords) != 3 || done.AttackRecords[0].StartAtMs != 0 {
			t.Fatal(done.AttackRecords)
		}
		for _, record := range done.AttackRecords {
			if math.Abs(record.AttackSpeed-1.125) > 1e-12 {
				t.Fatal(record)
			}
		}
		for _, actor := range done.FinalSnapshot.Combatants {
			if actor.Key == "source" && math.Abs(actor.Attributes["bonus_attack_speed_percent"].Resolved-.25) > 1e-12 {
				t.Fatal(actor)
			}
		}
	}
}

func TestPermanentSkillSourceRejectsUnsupportedOwnedHPModifier(t *testing.T) {
	input, request := sourceInitializationInput()
	addPermanentSkillSource(&input, &request, 0, "unsupported_health", "build", model.ModifierDefinition{
		ModifierKey: "health", Kind: "attribute", Target: "self.attr.hp", ValuePolicy: "add", Value: authoringConst(65)})
	compiled := authoringCompile(t, input)
	_, err := runtimeengine.RunGeneric(compiled, request)
	if err == nil || err.Code != model.GenericErrRuntimeInvariantFailed {
		t.Fatal(err)
	}
}
