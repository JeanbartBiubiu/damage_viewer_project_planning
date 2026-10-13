package compile

import (
	"encoding/json"
	"math"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func integerSchema(defaultValue, maximum float64) map[string]interface{} {
	return map[string]interface{}{"valueType": model.ProviderStateValueInteger, "defaultValue": defaultValue,
		"maxValue": maximum, "durationMs": float64(0)}
}

func TestIntegerStateSchemaCarriesExplicitValueType(test *testing.T) {
	raw, err := json.Marshal(model.ProviderStateFieldSchema{ValueType: model.ProviderStateValueInteger, MaxValue: 4})
	if err != nil {
		test.Fatal(err)
	}
	var field map[string]interface{}
	if err := json.Unmarshal(raw, &field); err != nil {
		test.Fatal(err)
	}
	request := minimalValidCompileRequest()
	request.SharedProviders[0].InitialStateSchema = map[string]interface{}{"discrete": field}
	result := CompileGeneric(request)
	if !result.OK || result.Session.Providers[0].StateFields["discrete"].ValueType != model.ProviderStateValueInteger {
		test.Fatal(result.Result.Errors, result.Session)
	}
}

func TestIntegerStateSchemaRejectsInvalidDefaultsAndCaps(test *testing.T) {
	for _, value := range []float64{-1, .5, 9007199254740992, math.Inf(1), math.NaN()} {
		for _, key := range []string{"defaultValue", "maxValue"} {
			request := minimalValidCompileRequest()
			field := integerSchema(0, 4)
			field[key] = value
			request.SharedProviders[0].InitialStateSchema = map[string]interface{}{"discrete": field}
			result := CompileGeneric(request)
			if result.OK || !hasErrorCode(result.Result.Errors, model.GenericErrFormulaTypeError) {
				test.Fatal(key, value, result.Result)
			}
		}
	}
	request := minimalValidCompileRequest()
	request.SharedProviders[0].InitialStateSchema = map[string]interface{}{"discrete": integerSchema(-1, .5)}
	result := CompileGeneric(request)
	paths := map[string]bool{}
	for _, issue := range result.Result.Errors {
		paths[issue.Path] = true
	}
	for _, key := range []string{"defaultValue", "maxValue"} {
		if !paths["sharedProviders[0].initialStateSchema.discrete."+key] {
			test.Fatal(result.Result.Errors)
		}
	}
}

func TestIntegerStateSchemaZeroAndNumberSemantics(test *testing.T) {
	for _, valueType := range []string{model.ProviderStateValueInteger, model.ProviderStateValueNumber, "", "unknown"} {
		request := minimalValidCompileRequest()
		field := integerSchema(0, 0)
		if valueType == "" {
			delete(field, "valueType")
		} else {
			field["valueType"] = valueType
		}
		if valueType == model.ProviderStateValueNumber || valueType == "" {
			field["defaultValue"], field["maxValue"] = -.5, 1.5
		}
		request.SharedProviders[0].InitialStateSchema = map[string]interface{}{"discrete": field}
		result := CompileGeneric(request)
		if result.OK != (valueType != "unknown") {
			test.Fatal(valueType, result.Result.Errors)
		}
	}
}

func TestIntegerStateConstantOperandsAreCheckedBeforeCap(test *testing.T) {
	for _, scenario := range []struct {
		amount float64
		policy string
		valid  bool
	}{{0, "override", true}, {5, "add", true}, {-1, "add", true}, {-1, "override", false}, {.5, "add", false}, {9007199254740992, "add", false}} {
		request := minimalValidCompileRequest()
		request.SharedProviders[0].InitialStateSchema = map[string]interface{}{"discrete": integerSchema(0, 4)}
		request.TypeCatalog.Types = append(request.TypeCatalog.Types, model.TypeCatalogEntry{Key: "state_scope/provider", Domain: "state_scope"})
		request.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{Operation: "state_change", Target: "self",
			Ref: "discrete", Types: []string{"state_scope/provider"}, ValuePolicy: scenario.policy,
			Amount: &model.GenericFormulaExpr{Op: "const", Value: model.Float64Ptr(scenario.amount)}}}
		result := CompileGeneric(request)
		if result.OK != scenario.valid {
			test.Fatal(scenario, result.Result.Errors)
		}
		if !scenario.valid {
			found := false
			for _, issue := range result.Result.Errors {
				found = found || strings.HasSuffix(issue.Path, ".amount")
			}
			if !found {
				test.Fatal(result.Result.Errors)
			}
		}
	}
}
