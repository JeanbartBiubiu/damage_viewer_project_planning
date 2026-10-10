package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

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
			if _, err := RunGeneric(compiled, request); err == nil || err.Code != model.GenericErrRuntimeInvariantFailed {
				t.Fatal("unsupported permanent aura accepted", err)
			}
		})
	}
}
