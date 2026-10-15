package compile

import (
	"strings"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func cooldownStateSchema() map[string]interface{} {
	return map[string]interface{}{
		"stateKind": model.ProviderStateKindCooldown, "defaultValue": float64(0), "maxValue": float64(1),
		"durationMs": float64(1000), "refreshPolicy": model.ProviderStateRefreshStartOnFirstWrite,
	}
}

func TestCompileCooldownStatePurposeRemainsExplicit(t *testing.T) {
	for _, marked := range []bool{false, true} {
		request := minimalValidCompileRequest()
		field := cooldownStateSchema()
		if !marked {
			delete(field, "stateKind")
		}
		request.SharedProviders[0].InitialStateSchema = map[string]interface{}{"internal_cd": field}
		result := CompileGeneric(request)
		if !result.OK {
			t.Fatal(result.Result.Errors)
		}
		compiled := result.Session.Providers[0].StateFields["internal_cd"]
		if (compiled.StateKind == model.ProviderStateKindCooldown) != marked || compiled.DurationMs != 1000 || compiled.DefaultValue != 0 || compiled.MaxValue != 1 || !compiled.HasCap || compiled.RefreshPolicy != model.ProviderStateRefreshStartOnFirstWrite || compiled.AmmoRecovery != nil {
			t.Fatal(marked, compiled)
		}
	}
}

func TestCompileCooldownRejectsInvalidStatePurpose(t *testing.T) {
	cases := []struct {
		field string
		value interface{}
	}{
		{"stateKind", "unknown"}, {"stateKind", nil}, {"stateKind", 1},
		{"defaultValue", float64(1)}, {"defaultValue", nil}, {"maxValue", float64(2)},
		{"maxValue", nil}, {"durationMs", float64(0)}, {"durationMs", nil},
		{"refreshPolicy", model.ProviderStateRefreshOnWrite}, {"refreshPolicy", ""}, {"refreshPolicy", nil},
		{"ammoRecovery", map[string]interface{}{}}, {"ammoRecovery", nil}, {"unknown", true},
	}
	for _, scenario := range cases {
		request := minimalValidCompileRequest()
		field := cooldownStateSchema()
		field[scenario.field] = scenario.value
		request.SharedProviders[0].InitialStateSchema = map[string]interface{}{"internal_cd": field}
		result := CompileGeneric(request)
		found := false
		for _, issue := range result.Result.Errors {
			found = found || strings.HasSuffix(issue.Path, ".internal_cd."+scenario.field)
		}
		if result.OK || !found {
			t.Fatal(scenario, result.Result.Errors)
		}
	}
}

func TestCompileCooldownCollectsDeclaredShapeErrors(t *testing.T) {
	request := minimalValidCompileRequest()
	field := cooldownStateSchema()
	field["defaultValue"], field["maxValue"], field["durationMs"], field["refreshPolicy"] = float64(1), float64(2), float64(0), ""
	request.SharedProviders[0].InitialStateSchema = map[string]interface{}{"internal_cd": field}
	result := CompileGeneric(request)
	if result.OK {
		t.Fatal("invalid cooldown schema compiled")
	}
	for _, key := range []string{"defaultValue", "maxValue", "durationMs", "refreshPolicy"} {
		if !hasErrorPath(result.Result.Errors, ".internal_cd."+key) {
			t.Fatal("missing collected shape error", key, result.Result.Errors)
		}
	}
}
