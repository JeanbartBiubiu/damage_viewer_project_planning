package compile

import (
	"testing"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func sceneParameterCompileInput(value float64) model.CompileRequest {
	request := phase3BCompileInput()
	request.Formulas[0] = formuladefinition.FromExpr("value", "probe", model.GenericFormulaExpr{Op: "read", Path: "ability.param.initial_count"}, nil)
	request.Formulas[0].Parameters[0].ValueType = "INTEGER"
	request.Formulas[0].Parameters[0].RuntimeSource = &model.FormulaRuntimeSource{Kind: "scene_parameter", Value: model.Float64Ptr(value)}
	request.SharedProviders[0].InitialStateSchema = map[string]any{"n": map[string]any{"valueType": "integer", "defaultValue": map[string]any{"op": "ref", "ref": "value"}, "maxValue": 10, "durationMs": 0}}
	return request
}

func TestSceneParameterFoldsForStaticFieldsAndApprovedValuesWithoutAbilityContext(t *testing.T) {
	for _, value := range []float64{0, 3} {
		request := sceneParameterCompileInput(value)
		compiled := CompileGeneric(request)
		if !compiled.OK {
			t.Fatal(value, compiled.Result.Errors)
		}
		approved, exists := compiled.Result.Metadata.ApprovedStaticValues["value"]
		if !exists || approved != value || compiled.Session.Providers[0].StateFields["n"].DefaultValue != value {
			t.Fatal("frozen scene input did not enter the existing static path", compiled.Result.Metadata, compiled.Session.Providers[0].StateFields)
		}
		*request.Formulas[0].Parameters[0].RuntimeSource.Value = 9
		request.Formulas[0].Parameters[0].RuntimeSource.Value = model.Float64Ptr(8)
		if got, err := compiled.Session.Formulas.Evaluation.Eval(0, formula.GenericEvalContext{}); err != nil || got != value {
			t.Fatal("compiled session retained a caller-owned value pointer", got, err)
		}
		newSession := CompileGeneric(request)
		if !newSession.OK || newSession.Result.Metadata.ApprovedStaticValues["value"] != 8 || compiled.Result.Metadata.ApprovedStaticValues["value"] != value {
			t.Fatal("separate preparations shared scene input", newSession.Result.Errors, newSession.Result.Metadata, compiled.Result.Metadata)
		}
	}
}

func TestSceneParameterDoesNotBypassDeclaredSkillOrLegacyStaticRestrictions(t *testing.T) {
	for _, scenario := range []string{"foreign_skill", "unbound", "ability_parameter", "use_charge_duration", "process_actual_cost"} {
		t.Run(scenario, func(t *testing.T) {
			request := sceneParameterCompileInput(3)
			param := &request.Formulas[0].Parameters[0]
			if scenario == "foreign_skill" {
				request.Formulas[0].SkillKey = "other_skill"
			} else if scenario == "unbound" {
				param.RuntimeSource = nil
			} else {
				param.RuntimeSource.Kind, param.RuntimeSource.Value = scenario, nil
				if scenario == "process_actual_cost" {
					param.RuntimeSource.ResourceKey = "mana"
				}
			}
			if result := CompileGeneric(request); result.OK {
				t.Fatal("existing formula scope/static restriction escaped", scenario)
			}
		})
	}
}
