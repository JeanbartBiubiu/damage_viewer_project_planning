// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	json "encoding/json"
	math "math"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

func TestPermanentIndependentAurasComposeBeforeNativeAttackAfterAttributeRename(t *testing.T) {
	for _, scenario := range []struct {
		name, speed, secondAttribute string
		wantSpeed                    float64
		wantStarts                   []int64
	}{
		{"same_speed_slot", "attack_speed", "attack_speed", .4, []int64{0, 2500}},
		{"renamed_same_slot", "tempo", "tempo", .4, []int64{0, 2500}},
		{"different_slots", "attack_speed", "armor", .8, []int64{0, 1250, 2500}},
		{"renamed_different_slots", "tempo", "armor", .8, []int64{0, 1250, 2500}},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			input, request := sourceInitializationInput()
			if scenario.speed == "tempo" {
				input, request = renamedCalculationSpeedInput()
				input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: model.EventTypeSourceInitialized, Domain: "event"})
			}
			request.StopPolicy.DurationMs = 3500
			for index := range input.Combatants {
				input.Combatants[index].Attributes["armor"] = authoringSlot(100)
				request.InitialSnapshot.Combatants[index].Attributes["armor"] = authoringSlot(100)
			}
			for index, attribute := range []string{scenario.speed, scenario.secondAttribute} {
				multiplier := .8
				if index == 1 {
					multiplier = .5
				}
				key := "independent_aura_one"
				if index == 1 {
					key = "independent_aura_two"
				}
				addNamedPermanentInitializer(&input, &request, 1, key, model.ModifierDefinition{
					ModifierKey: "owned_aura", Kind: "attribute", Target: "opponent.attr." + attribute,
					Stage: "total", ValuePolicy: "multiply", Value: authoringConst(multiplier),
				})
			}
			compiled := authoringCompile(t, input)
			var firstResult string
			for repeat := 0; repeat < 3; repeat++ {
				done, err := runtimeengine.RunGeneric(compiled, request)
				if err != nil || !done.Summary.Execution.Complete || len(done.AttackRecords) != len(scenario.wantStarts) {
					t.Fatal(repeat, err, done.Summary, done.AttackRecords)
				}
				for index, attack := range done.AttackRecords {
					if attack.StartAtMs != scenario.wantStarts[index] || math.Abs(attack.AttackSpeed-scenario.wantSpeed) > 1e-12 {
						t.Fatal(repeat, attack)
					}
				}
				wantArmor := 100.0
				if scenario.secondAttribute == "armor" {
					wantArmor = 50
				}
				if math.Abs(combatantAttrResolved(t, done.FinalSnapshot, "source", scenario.speed)-scenario.wantSpeed) > 1e-12 || combatantAttrResolved(t, done.FinalSnapshot, "source", "armor") != wantArmor || combatantAttrResolved(t, done.FinalSnapshot, "target", "armor") != 100 {
					t.Fatal(repeat, done.FinalSnapshot)
				}
				mounted := map[string]int{}
				for _, actor := range done.FinalSnapshot.Combatants {
					if actor.Key == "target" {
						for _, provider := range actor.Providers {
							mounted[provider.DefinitionRef]++
						}
					}
				}
				if mounted["independent_aura_one_owned_aura"] != 1 || mounted["independent_aura_two_owned_aura"] != 1 {
					t.Fatal("independent effects did not remain mounted", mounted)
				}
				encoded, encodingError := json.Marshal(done)
				if encodingError != nil || (repeat > 0 && string(encoded) != firstResult) {
					t.Fatal("same compiled session changed its full result", repeat, encodingError)
				}
				firstResult = string(encoded)
			}
		})
	}
}

func TestPermanentAuraUsesDeclaredOpponentAttribute(t *testing.T) {
	input, request := sourceInitializationInput()
	for index := range input.Combatants {
		input.Combatants[index].Attributes["armor"] = authoringSlot(100)
		request.InitialSnapshot.Combatants[index].Attributes["armor"] = authoringSlot(100)
		multiplier := .8
		if index == 1 {
			multiplier = 1.1
		}
		addPermanentInitializer(&input, &request, index, model.ModifierDefinition{
			ModifierKey: "declared_aura", Kind: "attribute", Target: "opponent.attr.armor",
			Stage: "total", ValuePolicy: "multiply", Value: authoringConst(multiplier),
		})
	}
	for repeat := 0; repeat < 3; repeat++ {
		done := authoringRun(t, input, request)
		if math.Abs(combatantAttrResolved(t, done.FinalSnapshot, "source", "armor")-110) > 1e-9 || combatantAttrResolved(t, done.FinalSnapshot, "target", "armor") != 80 {
			t.Fatal(repeat, done.FinalSnapshot)
		}
	}
}

func TestPermanentAuraRejectsUnsupportedSlotAndCalculation(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		target string
		stage  string
		policy string
		value  float64
	}{
		{"health", "opponent.attr.hp", "total", "multiply", .8},
		{"missing_slot", "opponent.attr.mystery", "total", "multiply", .8},
		{"negative", "opponent.attr.armor", "total", "multiply", -.8},
		{"wrong_stage", "opponent.attr.armor", "percent", "multiply", .8},
		{"wrong_policy", "opponent.attr.armor", "total", "percent_add", .8},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			input, request := sourceInitializationInput()
			formuladefinition.DeclareAttributes(&input, "mystery")
			addPermanentInitializer(&input, &request, 1, model.ModifierDefinition{
				ModifierKey: "invalid_aura", Kind: "attribute", Target: scenario.target,
				Stage: scenario.stage, ValuePolicy: scenario.policy, Value: authoringConst(scenario.value),
			})
			compiled := authoringCompile(t, input)
			if _, err := runtimeengine.RunGeneric(compiled, request); err == nil || err.Code != model.GenericErrRuntimeInvariantFailed {
				t.Fatal("unsupported permanent aura accepted", err)
			}
		})
	}
}
