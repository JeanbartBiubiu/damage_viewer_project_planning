package compile

import (
	"testing"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func authoredAbilityInputFormula(key, skill, parameter string) model.NamedFormula {
	def := formuladefinition.FromExpr(key, skill, model.GenericFormulaExpr{Op: "read", Path: "ability.param." + parameter}, nil)
	def.Parameters[0].RuntimeSource = &model.FormulaRuntimeSource{Kind: "ability_parameter"}
	def.Parameters[0].ValueType = "INTEGER"
	return def
}

func TestAuthoredAbilityParameterCannotBypassConditionsStaticOrSkillScope(t *testing.T) {
	for _, scenario := range []string{"condition", "static", "foreign_skill", "value", "resource", "unknown_source"} {
		t.Run(scenario, func(t *testing.T) {
			request := phase3BCompileInput()
			request.Formulas[0] = authoredAbilityInputFormula("value", "probe", "basis")
			request.SharedProviders[0].Abilities[0].Params = map[string]float64{"basis": 0}
			switch scenario {
			case "condition":
				request.SharedProviders[0].Abilities[0].CastCondition = &model.GenericFormulaExpr{Op: "ref", Ref: "value"}
			case "static":
				request.SharedProviders[0].InitialStateSchema = map[string]any{"n": map[string]any{"defaultValue": map[string]any{"op": "ref", "ref": "value"}}}
			case "foreign_skill":
				request.Formulas[0].SkillKey = "foreign"
			case "value":
				request.Formulas[0].Parameters[0].Value = model.Float64Ptr(0)
			case "resource":
				request.Formulas[0].Parameters[0].RuntimeSource.ResourceKey = "mana"
			case "unknown_source":
				request.Formulas[0].Parameters[0].RuntimeSource.Kind = "guess"
			}
			if result := CompileGeneric(request); result.OK {
				t.Fatal("runtime ability source escaped guard", scenario)
			}
		})
	}
}

func TestAuthoredAbilityParameterForeignProviderCannotBorrowCurrentAbility(t *testing.T) {
	request := phase3BCompileInput()
	request.Formulas[0] = authoredAbilityInputFormula("foreign_value", "foreign", "basis")
	request.SharedProviders[0].Abilities[0].Params = map[string]float64{"basis": 2}
	request.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "foreign_state"}}
	request.SharedProviders = append(request.SharedProviders, model.ProviderDefinition{ProviderKey: "foreign_state", SkillKey: "foreign", StableID: "foreign_state", Kind: "status", Lifecycle: &model.ProviderLifecycle{DurationMs: &model.GenericFormulaExpr{Op: "ref", Ref: "foreign_value"}}})
	if result := CompileGeneric(request); result.OK || !hasErrorPath(result.Result.Errors, "operations[0]") {
		t.Fatal("foreign ability parameter borrowed current ability", result.Result.Errors)
	}
}

func TestAuthoredAbilityParameterProcessCountAllowsOnlyExplicitSource(t *testing.T) {
	for _, declared := range []bool{true, false} {
		request := automaticBindingCompileRequest()
		request.Formulas = []model.NamedFormula{authoredAbilityInputFormula("segment_count", "skill:q", "scene_loops")}
		if !declared {
			request.Formulas[0].Parameters[0].RuntimeSource = nil
		}
		first := "IMMEDIATE"
		request.SharedProviders[0].Processes[0].Steps = []model.ProcessStepDefinition{{StepKey: "finite_channel", StepType: "CHANNEL", OccupiesAction: model.BoolPtr(true), DurationMs: processCompileNumber(1000), ExecutionCount: &model.GenericFormulaExpr{Op: "ref", Ref: "segment_count"}, FirstExecution: &first}}
		request.SharedProviders[0].Abilities[0].Params = map[string]float64{"scene_loops": 4}
		result := CompileGeneric(request)
		if result.OK != declared {
			t.Fatal(declared, result.Result.Errors)
		}
		if declared && !result.Session.SkillActionBindings[0].AutomaticEligible {
			t.Fatal("single finite channel was not admitted", result.Session.SkillActionBindings[0])
		}
	}
}
