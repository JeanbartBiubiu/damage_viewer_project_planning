package compile

import (
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestAttributeDerivationRejectsCyclesMissingAndRuntimeReads(t *testing.T) {
	for _, readPath := range []string{"source.attr.attack_speed.resolved", "source.attr.missing.base", "provider.state.stacks", "source.resource.mana.current"} {
		t.Run(readPath, func(t *testing.T) {
			input := loadGenericFixtureCompileRequest(t, "generic_p0_basic_damage.json")
			input.Combatants[0].Attributes["attack_speed"] = model.AttributeSlotDef{Base: 1, Current: 1, Max: 1, Resolved: 1}
			input.Rules.AttributeDerivations = []model.AttributeDerivationDefinition{{CombatantKey: "source", AttributeKey: "attack_speed", Value: model.GenericFormulaExpr{Op: "read", Path: readPath}}}
			if result := CompileGeneric(input); result.OK {
				t.Fatal("invalid derivation accepted")
			}
		})
	}
}

func TestAttributeDerivationAllowsFrozenBaseAndRejectsDuplicates(t *testing.T) {
	input := loadGenericFixtureCompileRequest(t, "generic_p0_basic_damage.json")
	input.Combatants[0].Attributes["attack_speed"] = model.AttributeSlotDef{Base: 1, Current: 1, Max: 1, Resolved: 1}
	definition := model.AttributeDerivationDefinition{CombatantKey: "source", AttributeKey: "attack_speed", Value: model.GenericFormulaExpr{Op: "read", Path: "source.attr.attack_speed.base"}}
	input.Rules.AttributeDerivations = []model.AttributeDerivationDefinition{definition}
	if result := CompileGeneric(input); !result.OK {
		t.Fatal(result.Result.Errors)
	}
	input.Rules.AttributeDerivations = append(input.Rules.AttributeDerivations, definition)
	if result := CompileGeneric(input); result.OK {
		t.Fatal("duplicate derivation accepted")
	}
}
