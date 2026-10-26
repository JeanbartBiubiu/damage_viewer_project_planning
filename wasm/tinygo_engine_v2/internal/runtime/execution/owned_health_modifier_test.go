package execution

import (
	json "encoding/json"
	math "math"
	strings "strings"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

func ownedHealthPassiveInput(owner string) (model.CompileRequest, model.RunRequest) {
	input, request := sourceInitializationInput()
	for _, key := range []string{"hp", "bonus_attack_speed_percent", "attack_speed_ratio"} {
		input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: key, Domain: "attribute"})
	}
	request.StopPolicy.DurationMs = 1
	request.DriverPlan.BasicAttack.AttackSpeedInputMax = 4
	setCombatantAttr(&input, &request, "source", "hp", model.AttributeSlotDef{Base: 1000, Current: 500, Max: 1000, Resolved: 1000})
	setCombatantAttr(&input, &request, "target", "hp", model.AttributeSlotDef{Base: 10000, Current: 2000, Max: 10000, Resolved: 10000})
	for _, side := range []string{"source", "target"} {
		setCombatantAttr(&input, &request, side, "bonus_attack_speed_percent", authoringSlot(0))
		setCombatantAttr(&input, &request, side, "attack_speed_ratio", authoringSlot(1))
		setCombatantAttr(&input, &request, side, "attack_speed", authoringSlot(1))
	}
	amount := authoringBinary("mul", authoringConst(2), authoringBinary("sub", authoringConst(1), authoringBinary("div", authoringRead("source.attr.hp.current"), authoringRead("source.attr.hp.max"))))
	input.Formulas = append(input.Formulas, formuladefinition.FromExpr("health_bonus", "health_passive", amount, nil))
	index := 0
	if owner == "target" {
		index = 1
	}
	addPermanentSkillSource(&input, &request, index, "health_passive", "character", model.ModifierDefinition{
		ModifierKey: "speed", Kind: "attribute", Target: "self.attr.bonus_attack_speed_percent", ValuePolicy: "add", Value: model.GenericFormulaExpr{Op: "ref", Ref: "health_bonus"}})
	for i := len(input.SharedProviders) - 2; i < len(input.SharedProviders); i++ {
		input.SharedProviders[i].SkillKey = "health_passive"
	}
	input.Rules.AttributeDerivations = []model.AttributeDerivationDefinition{attackSpeedDerivation("source"), attackSpeedDerivation("target")}
	return input, request
}

func TestOwnedHealthModifierReverseFrameCacheUsesOwnerHealthAndPresence(t *testing.T) {
	for _, owner := range []string{"source", "target"} {
		t.Run(owner, func(t *testing.T) {
			input, request := ownedHealthPassiveInput(owner)
			request.DriverPlan.BasicAttack = nil
			compiled := authoringCompile(t, input)
			state, err := newGenericRunState(compiled, request)
			if err != nil {
				t.Fatal(err)
			}
			if err := state.runLoop(); err != nil {
				t.Fatal("real source initialization failed", err)
			}
			frame := state.newExecutionFrame("target", "source", "")
			for _, health := range []struct{ current, max float64 }{{500, 1000}, {750, 1000}, {750, 1500}, {750, 1500}} {
				staged := frame.stageFor(owner)
				hp := staged.attributesView().At("hp")
				hp.Current, hp.Max = health.current, health.max

				staged.setAttributes(staged.attributesView().With("hp", hp))
				frame.reResolveStagedAttributesTwoPass(compiled.Abilities[0])
				if frame.fatal {
					t.Fatal(frame.fatalErr)
				}
				expected := 2 * (1 - health.current/health.max)
				if got := frame.stageFor(owner).attributesView().At("bonus_attack_speed_percent").Resolved; math.Abs(got-expected) > 1e-12 {
					t.Fatalf("reverse owner %s HP=%+v got=%v expected=%v", owner, health, got, expected)
				}
			}
			var absentCurrent model.AttributeSlotDef
			if err := json.Unmarshal([]byte(`{"base":1000,"max":1500,"resolved":1000}`), &absentCurrent); err != nil {
				t.Fatal(err)
			}

			frame.stageFor(owner).setAttributes(frame.stageFor(owner).attributesView().With("hp", absentCurrent))
			frame.reResolveStagedAttributesTwoPass(compiled.Abilities[0])
			if !frame.fatal || frame.fatalErr == nil || !strings.Contains(frame.fatalErr.Path, "/expression") {
				t.Fatal("warm cache masked the missing owner CURRENT field", frame.fatalErr)
			}
		})
	}
}
