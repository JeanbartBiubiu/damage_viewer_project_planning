package compile

import (
	"testing"

	"tinygo_engine_v2/internal/model"
)

func anchoredTickBaseRequest(t *testing.T) model.CompileRequest {
	t.Helper()
	req := minimalValidCompileRequest()
	req.TypeCatalog.Types = append(req.TypeCatalog.Types,
		model.TypeCatalogEntry{Key: "ability/tick", Domain: "ability"},
		model.TypeCatalogEntry{Key: "state_scope/provider_target", Domain: "state_scope"},
		model.TypeCatalogEntry{Key: "state_scope/provider", Domain: "state_scope"},
		model.TypeCatalogEntry{Key: "damage/true", Domain: "damage"},
	)
	req.SharedProviders[0].InitialStateSchema = map[string]interface{}{
		"venom_stacks": map[string]interface{}{
			"defaultValue":  float64(0),
			"maxValue":      float64(6),
			"durationMs":    float64(6000),
			"refreshPolicy": model.ProviderStateRefreshOnWrite,
		},
	}
	req.SharedProviders[0].Abilities = append(req.SharedProviders[0].Abilities, model.AbilityDefinition{
		AbilityKey: "venom_tick",
		Kind:       "tick",
		Types:      []string{"ability/tick"},
		TickSpec: &model.TickSpec{
			IntervalMs:     1000,
			AnchorScope:    "state_scope/provider_target",
			AnchorStateKey: "venom_stacks",
			OnTick: []model.OperationDefinition{{
				Operation:  "damage",
				Target:     "target",
				DamageType: "damage/true",
				Amount:     &model.GenericFormulaExpr{Op: "const", Value: floatPtrCompile(10)},
			}},
		},
	})
	return req
}

func floatPtrCompile(v float64) *float64 { return &v }

func TestCompileGenericAnchoredTickSpecSuccess(t *testing.T) {
	req := anchoredTickBaseRequest(t)
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	var tick *CompiledAbility
	for i := range result.Session.Abilities {
		if result.Session.Abilities[i].AbilityKey == "venom_tick" {
			tick = &result.Session.Abilities[i]
			break
		}
	}
	if tick == nil || tick.TickSpec == nil {
		t.Fatal("missing venom_tick")
	}
	if !tick.TickSpec.IsAnchored() {
		t.Fatalf("expected anchored tickSpec, got %+v", tick.TickSpec)
	}
	if tick.TickSpec.StartDelayMs != 0 {
		t.Fatalf("anchored startDelayMs=%d want 0", tick.TickSpec.StartDelayMs)
	}
	if tick.TickSpec.IntervalMs != 1000 {
		t.Fatalf("intervalMs=%d", tick.TickSpec.IntervalMs)
	}
}

func TestCompileGenericOmittedAnchorPairPreservesStartDelayDefault(t *testing.T) {
	req := anchoredTickBaseRequest(t)
	req.SharedProviders[0].Abilities[1].TickSpec.AnchorScope = ""
	req.SharedProviders[0].Abilities[1].TickSpec.AnchorStateKey = ""
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	tick := result.Session.Abilities[1]
	if tick.TickSpec.IsAnchored() {
		t.Fatal("expected non-anchored")
	}
	if tick.TickSpec.StartDelayMs != 1000 {
		t.Fatalf("startDelayMs=%d want 1000 (default=interval)", tick.TickSpec.StartDelayMs)
	}
}

func TestCompileGenericAnchoredTickRejectsPartialPair(t *testing.T) {
	req := anchoredTickBaseRequest(t)
	req.SharedProviders[0].Abilities[1].TickSpec.AnchorStateKey = ""
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected failure for partial anchor pair")
	}
	if !hasErrorCode(result.Result.Errors, model.GenericErrMissingRequiredField) {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}

	req = anchoredTickBaseRequest(t)
	req.SharedProviders[0].Abilities[1].TickSpec.AnchorScope = ""
	result = CompileGeneric(req)
	if result.OK {
		t.Fatal("expected failure for partial anchor pair (scope missing)")
	}
	if !hasErrorCode(result.Result.Errors, model.GenericErrMissingRequiredField) {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
}

func TestCompileGenericAnchoredTickRejectsNonzeroStartDelay(t *testing.T) {
	req := anchoredTickBaseRequest(t)
	req.SharedProviders[0].Abilities[1].TickSpec.StartDelayMs = 500
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected failure for nonzero startDelayMs")
	}
	if !hasErrorCode(result.Result.Errors, model.GenericErrMissingRequiredField) {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
}

func TestCompileGenericAnchoredTickRejectsWrongScope(t *testing.T) {
	req := anchoredTickBaseRequest(t)
	req.SharedProviders[0].Abilities[1].TickSpec.AnchorScope = "state_scope/provider"
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected failure for wrong anchorScope")
	}
	if !hasErrorCode(result.Result.Errors, model.GenericErrUnknownTypeKey) {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
}

func TestCompileGenericAnchoredTickRejectsUnknownKey(t *testing.T) {
	req := anchoredTickBaseRequest(t)
	req.SharedProviders[0].Abilities[1].TickSpec.AnchorStateKey = "missing_key"
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected failure for unknown anchor key")
	}
	if !hasErrorCode(result.Result.Errors, model.GenericErrUnknownRef) {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
}

func TestCompileGenericAnchoredTickRejectsDurationZero(t *testing.T) {
	req := anchoredTickBaseRequest(t)
	req.SharedProviders[0].InitialStateSchema = map[string]interface{}{
		"venom_stacks": map[string]interface{}{
			"defaultValue": float64(0),
			"maxValue":     float64(6),
			"durationMs":   float64(0),
		},
	}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected failure for durationMs=0")
	}
	if !hasErrorCode(result.Result.Errors, model.GenericErrMissingRequiredField) {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
}

func TestCompileGenericAnchoredTickRejectsMissingRefreshOnWrite(t *testing.T) {
	req := anchoredTickBaseRequest(t)
	req.SharedProviders[0].InitialStateSchema = map[string]interface{}{
		"venom_stacks": map[string]interface{}{
			"defaultValue": float64(0),
			"maxValue":     float64(6),
			"durationMs":   float64(6000),
		},
	}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected failure for missing refresh_on_write")
	}
	if !hasErrorCode(result.Result.Errors, model.GenericErrMissingRequiredField) {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
}
