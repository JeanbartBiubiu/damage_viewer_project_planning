package compile

import (
	"strings"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func sdcTimedSchema(key string, durationMs float64) map[string]interface{} {
	return map[string]interface{}{
		key: map[string]interface{}{
			"defaultValue":  float64(0),
			"maxValue":      float64(1),
			"durationMs":    durationMs,
			"refreshPolicy": model.ProviderStateRefreshOnWrite,
		},
	}
}

func sdcUntimedSchema(key string) map[string]interface{} {
	return map[string]interface{}{
		key: map[string]interface{}{
			"defaultValue": float64(0),
			"maxValue":     float64(1),
			"durationMs":   float64(0),
		},
	}
}

func sdcValidOp(ref string) model.OperationDefinition {
	oneThousand := 1000.0
	return model.OperationDefinition{
		Operation:   model.OperationKindStateDurationChange,
		Target:      "source",
		Ref:         ref,
		Types:       []string{"state_scope/provider"},
		ValuePolicy: "subtract",
		Amount:      &model.GenericFormulaExpr{Op: "const", Value: &oneThousand},
	}
}

func TestCompileStateDurationChangeAcceptsProviderAndProviderTarget(t *testing.T) {
	for _, scope := range []string{"state_scope/provider", "state_scope/provider_target"} {
		req := minimalValidCompileRequest()
		req.SharedProviders[0].InitialStateSchema = sdcTimedSchema("flurry_cd", 30000)
		op := sdcValidOp("flurry_cd")
		op.Types = []string{scope}
		req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{op}
		result := CompileGeneric(req)
		if !result.OK {
			t.Fatalf("scope=%s compile failed: %+v", scope, result.Result.Errors)
		}
		found := false
		for _, compiled := range result.Session.Operations {
			if compiled.Operation != model.OperationKindStateDurationChange {
				continue
			}
			found = true
			if compiled.StateScope != scope {
				t.Fatalf("scope=%s got StateScope=%q", scope, compiled.StateScope)
			}
			if compiled.ValuePolicy != "subtract" || compiled.Ref != "flurry_cd" || !compiled.HasAmount {
				t.Fatalf("compiled=%+v", compiled)
			}
		}
		if !found {
			t.Fatalf("scope=%s: missing compiled state_duration_change", scope)
		}
	}
}

func TestCompileStateDurationChangeAcceptsSourceAndSelf(t *testing.T) {
	for _, target := range []string{"source", "self"} {
		req := minimalValidCompileRequest()
		req.SharedProviders[0].InitialStateSchema = sdcTimedSchema("timed", 6000)
		op := sdcValidOp("timed")
		op.Target = target
		req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{op}
		result := CompileGeneric(req)
		if !result.OK {
			t.Fatalf("target=%s compile failed: %+v", target, result.Result.Errors)
		}
	}
}

func TestCompileStateDurationChangeRejectsMissingTarget(t *testing.T) {
	req := minimalValidCompileRequest()
	req.SharedProviders[0].InitialStateSchema = sdcTimedSchema("timed", 6000)
	op := sdcValidOp("timed")
	op.Target = ""
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{op}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected compile failure for empty target")
	}
	if !hasErrorPath(result.Result.Errors, "target") {
		t.Fatalf("missing target error path: %+v", result.Result.Errors)
	}
	found := false
	for _, err := range result.Result.Errors {
		if containsStr(err.Message, "target must be source or self") {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("missing target family error: %+v", result.Result.Errors)
	}
}

func TestCompileStateDurationChangeCollectAllErrors(t *testing.T) {
	req := minimalValidCompileRequest()
	req.SharedProviders[0].InitialStateSchema = sdcUntimedSchema("untimed")
	// Intentionally invalid: missing amount/ref/policy/scope, illegal target, unknown + untimed keys.
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:   model.OperationKindStateDurationChange,
			Target:      "target",
			ValuePolicy: "add",
			Types:       []string{"state_scope/unknown"},
		},
		{
			Operation:   model.OperationKindStateDurationChange,
			Target:      "source",
			Ref:         "missing_key",
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "subtract",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: floatPtr(1000)},
		},
		{
			Operation:   model.OperationKindStateDurationChange,
			Target:      "source",
			Ref:         "untimed",
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "subtract",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: floatPtr(1000)},
		},
		{
			Operation:   model.OperationKindStateDurationChange,
			Target:      "source",
			Ref:         "untimed",
			Types:       []string{"state_scope/provider", "state_scope/provider_target"},
			ValuePolicy: "subtract",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: floatPtr(1000)},
		},
	}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected compile failure")
	}
	wantPaths := []string{
		"valuePolicy",
		"target",
		"types",
		"ref",
		"amount",
	}
	for _, needle := range wantPaths {
		if !hasErrorPath(result.Result.Errors, needle) {
			t.Fatalf("missing error path containing %q: %+v", needle, result.Result.Errors)
		}
	}
	// Unknown + untimed + dual-scope must all surface.
	var sawUnknown, sawUntimed, sawDual bool
	for _, err := range result.Result.Errors {
		switch {
		case containsStr(err.Message, "unknown state key"):
			sawUnknown = true
		case containsStr(err.Message, "durationMs>0"):
			sawUntimed = true
		case containsStr(err.Message, "single state scope"):
			sawDual = true
		}
	}
	if !sawUnknown || !sawUntimed || !sawDual {
		t.Fatalf("unknown/untimed/dual=%v/%v/%v errors=%+v", sawUnknown, sawUntimed, sawDual, result.Result.Errors)
	}
}

func TestCompileStateDurationChangeRejectsMissingProviderContext(t *testing.T) {
	req := minimalValidCompileRequest()
	oneThousand := 1000.0
	req.Rules.Operations = []model.OperationDefinition{{
		Operation:   model.OperationKindStateDurationChange,
		Target:      "source",
		Ref:         "timed",
		Types:       []string{"state_scope/provider"},
		ValuePolicy: "subtract",
		Amount:      &model.GenericFormulaExpr{Op: "const", Value: &oneThousand},
	}}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected compile failure for rules-level op without provider context")
	}
	if !hasErrorPath(result.Result.Errors, "operation") {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
	found := false
	for _, err := range result.Result.Errors {
		if containsStr(err.Message, "owning provider context") {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("missing provider context error: %+v", result.Result.Errors)
	}
}

func TestCompileStateDurationChangeRejectsEmptyPolicyAndMissingFields(t *testing.T) {
	req := minimalValidCompileRequest()
	req.SharedProviders[0].InitialStateSchema = sdcTimedSchema("timed", 6000)
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{
		Operation: model.OperationKindStateDurationChange,
		Target:    "source",
		Types:     []string{"state_scope/provider"},
	}}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected compile failure")
	}
	for _, needle := range []string{"ref", "amount", "valuePolicy"} {
		if !hasErrorPath(result.Result.Errors, needle) {
			t.Fatalf("missing %q error: %+v", needle, result.Result.Errors)
		}
	}
}

func containsStr(s, needle string) bool {
	return strings.Contains(s, needle)
}
