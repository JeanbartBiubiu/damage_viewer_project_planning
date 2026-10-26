// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	math "math"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
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

func TestContinuousAttackEquipmentSpeedUsesRatioWithoutDoubleGrowth(t *testing.T) {
	input, request := continuousAttackInput(.8, 10000, 100, 0, 0, 2400)
	request.DriverPlan.BasicAttack.AttackSpeedInputMax = 2
	for key, amount := range map[string]float64{"attack_speed_ratio": .5, "bonus_attack_speed_percent": .2} {
		input.Combatants[0].Attributes[key] = authoringSlot(amount)
		request.InitialSnapshot.Combatants[0].Attributes[key] = authoringSlot(amount)
	}
	addFixedEquipment(&input, &request, 0, "item_1042", "bonus_attack_speed_percent", .1)
	input.Rules.AttributeDerivations = []model.AttributeDerivationDefinition{attackSpeedDerivation("source")}
	done := authoringRun(t, input, request)
	if len(done.AttackRecords) != 3 || done.AttackRecords[1].StartAtMs != 1176 || done.AttackRecords[2].StartAtMs != 2352 {
		t.Fatal(done.AttackRecords)
	}
	for _, row := range done.AttackRecords {
		if math.Abs(row.AttackSpeed-.85) > 1e-12 {
			t.Fatal(row)
		}
	}
	for _, actor := range done.FinalSnapshot.Combatants {
		if actor.Key == "source" && (actor.Attributes["attack_speed"].Base != .8 || math.Abs(actor.Attributes["attack_speed"].Resolved-.85) > 1e-12 || actor.Attributes["bonus_attack_speed_percent"].Base != .2) {
			t.Fatal(actor.Attributes)
		}
	}
}

func TestEquipmentAttackSpeedUsesAuthoredRatioAndRejectsNonPositiveOutput(t *testing.T) {
	for _, ratio := range []float64{0, -1, -10, -20} {
		input, request := continuousAttackInput(1, 10000, 100, 0, 0, 1000)
		for key, amount := range map[string]float64{"attack_speed_ratio": ratio, "bonus_attack_speed_percent": 0} {
			input.Combatants[0].Attributes[key] = authoringSlot(amount)
			request.InitialSnapshot.Combatants[0].Attributes[key] = authoringSlot(amount)
		}
		addFixedEquipment(&input, &request, 0, "item_1042", "bonus_attack_speed_percent", .1)
		input.Rules.AttributeDerivations = []model.AttributeDerivationDefinition{attackSpeedDerivation("source")}
		compiled := authoringCompile(t, input)
		done, err := runtimeengine.RunGeneric(compiled, request)
		wantSpeed := 1 + ratio*.1
		if wantSpeed <= 0 {
			if err == nil {
				t.Fatalf("nonpositive authored final speed %v accepted", wantSpeed)
			}
			continue
		}
		if err != nil || math.Abs(done.FinalSnapshot.Combatants[0].Attributes["attack_speed"].Resolved-wantSpeed) > 1e-12 {
			t.Fatalf("ratio %v final speed must follow authored math: want %v, done=%+v err=%+v", ratio, wantSpeed, done.FinalSnapshot, err)
		}
		if len(done.AttackRecords) == 0 || math.Abs(done.AttackRecords[0].AttackSpeed-wantSpeed) > 1e-12 {
			t.Fatal("continuous consumer did not use authored final speed", done.AttackRecords)
		}
	}
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

func TestContinuousAttackFixedEquipmentOwnedContributions(t *testing.T) {
	input, request := continuousAttackInput(1, 250, 100, 0, 0, 5000)
	addFixedEquipment(&input, &request, 0, "item_1036", "attack_damage", 10)
	addFixedEquipment(&input, &request, 1, "item_1036", "attack_damage", 10)
	input.Combatants[1].Attributes["attack_damage"] = authoringSlot(0)
	request.InitialSnapshot.Combatants[1].Attributes["attack_damage"] = authoringSlot(0)
	addFixedEquipment(&input, &request, 1, "item_1028", "hp", 150)
	hp := input.Combatants[1].Attributes["hp"]
	hp.Base, hp.Resolved = 100, 100
	input.Combatants[1].Attributes["hp"] = hp
	request.InitialSnapshot.Combatants[1].Attributes["hp"] = hp
	done := authoringRun(t, input, request)
	if done.Summary.SourceDamageDealt != 330 || done.Summary.TargetHpLoss != 250 || done.Summary.BasicAttack.CompletedCount != 3 {
		t.Fatal(done.Summary)
	}
	for _, actor := range done.FinalSnapshot.Combatants {
		if actor.Key == "source" && (actor.Attributes["attack_damage"].Base != 100 || actor.Attributes["attack_damage"].Resolved != 110) {
			t.Fatal(actor.Attributes)
		}
		if actor.Key == "target" && (actor.Attributes["attack_damage"].Resolved != 10 || actor.Attributes["hp"].Base != 100 || actor.Attributes["hp"].Max != 250) {
			t.Fatal(actor.Attributes)
		}
	}
}

func TestContinuousAttackRejectsForgedEquipmentStateAndHp(t *testing.T) {
	for _, corruption := range []string{"owner", "duplicate", "hp_max", "stacks"} {
		t.Run(corruption, func(t *testing.T) {
			input, request := continuousAttackInput(1, 250, 100, 0, 0, 1000)
			addFixedEquipment(&input, &request, 0, "item_1036", "attack_damage", 10)
			switch corruption {
			case "owner":
				request.InitialSnapshot.Combatants[0].Providers[0].Owner = "target"
			case "duplicate":
				request.InitialSnapshot.Combatants[0].Providers[1] = request.InitialSnapshot.Combatants[0].Providers[0]
			case "stacks":
				request.InitialSnapshot.Combatants[0].Providers[0].Stacks = 6
			case "hp_max":
				hp := input.Combatants[0].Attributes["hp"]
				hp.Max++
				input.Combatants[0].Attributes["hp"], request.InitialSnapshot.Combatants[0].Attributes["hp"] = hp, hp
			}
			compiled := authoringCompile(t, input)
			if _, err := runtimeengine.RunGeneric(compiled, request); err == nil {
				t.Fatal("forged equipment accepted")
			}
		})
	}
}

func TestSingleAttackEquipmentHpUsesNativeMaximum(t *testing.T) {
	for _, forged := range []bool{false, true} {
		input, request := authoringInput()
		addFixedEquipment(&input, &request, 1, "item_1028", "hp", 150)
		hp := input.Combatants[1].Attributes["hp"]
		if !forged {
			hp.Max = hp.Base + 150
		}
		input.Combatants[1].Attributes["hp"], request.InitialSnapshot.Combatants[1].Attributes["hp"] = hp, hp
		compiled := authoringCompile(t, input)
		done, err := runtimeengine.RunGeneric(compiled, request)
		if forged && err == nil {
			t.Fatal("single attack accepted forged equipped maximum")
		}
		if !forged {
			if err != nil {
				t.Fatal(err)
			}
			if done.Summary.TargetFinalHp >= hp.Current {
				t.Fatal(done.Summary)
			}
		}
	}
}
