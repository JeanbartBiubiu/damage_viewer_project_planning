package compile

import (
	"testing"

	"tinygo_engine_v2/internal/model"
)

func ensureCastOriginCatalog(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "event/damage_instance", Domain: "event"},
		{Key: "event/source_owner", Domain: "event"},
		{Key: "cast_origin/champion", Domain: "cast_origin"},
		{Key: "cast_origin/item", Domain: "cast_origin"},
		{Key: "cast_origin/pet", Domain: "cast_origin"},
		{Key: "cast_origin/innate", Domain: "cast_origin"},
		{Key: "ability/spell", Domain: "ability"},
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "damage_trait/ability", Domain: "damage_trait"},
		{Key: "damage_trait/pet", Domain: "damage_trait"},
		{Key: "damage_trait/proc", Domain: "damage_trait"},
		{Key: "damage/physical", Domain: "damage"},
		{Key: "state_scope/provider", Domain: "state_scope"},
	}
	have := map[string]bool{}
	for _, t := range req.TypeCatalog.Types {
		have[t.Key] = true
	}
	for _, t := range need {
		if !have[t.Key] {
			req.TypeCatalog.Types = append(req.TypeCatalog.Types, t)
		}
	}
}

func TestCompileCastOriginAndPerCastThrottleCollectAll(t *testing.T) {
	req := minimalValidCompileRequest()
	ensureCastOriginCatalog(&req)
	req.SharedProviders[0].Abilities[0].CastOrigin = "champion"
	req.SharedProviders[0].Listeners = []model.ListenerDefinition{{
		ListenerKey: "ok_throttle",
		EventMatcher: model.TypeMatcher{
			All: []string{"event/damage_instance"},
		},
		PerCastThrottleMs: 1000,
		Operations: []model.OperationDefinition{{
			Operation: "damage",
			Target:    "target",
			DamageType: "damage/physical",
			Amount:    &model.GenericFormulaExpr{Op: "const", Value: floatPtr(1)},
		}},
	}}
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("expected ok: %+v", result.Result.Errors)
	}
	if result.Session.Abilities[0].CastOrigin != model.CastOriginChampion {
		t.Fatalf("compiled castOrigin=%q", result.Session.Abilities[0].CastOrigin)
	}
	found := false
	for _, l := range result.Session.Listeners {
		if l.ListenerKey == "ok_throttle" {
			found = true
			if l.PerCastThrottleMs != 1000 {
				t.Fatalf("compiled throttle=%d", l.PerCastThrottleMs)
			}
		}
	}
	if !found {
		t.Fatal("ok_throttle listener not bound")
	}
}

func TestCompileCastOriginAndThrottleCollectAllErrors(t *testing.T) {
	req := minimalValidCompileRequest()
	ensureCastOriginCatalog(&req)
	req.SharedProviders[0].Abilities[0].CastOrigin = "totem"
	req.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:       "neg_throttle",
			EventMatcher:      model.TypeMatcher{All: []string{"event/damage_instance"}},
			PerCastThrottleMs: -5,
			Operations: []model.OperationDefinition{{
				Operation: "damage", Target: "target", DamageType: "damage/physical",
				Amount: &model.GenericFormulaExpr{Op: "const", Value: floatPtr(1)},
			}},
		},
		{
			ListenerKey: "bad_ctx",
			EventMatcher: model.TypeMatcher{
				Any: []string{"event/damage_instance"}, // Any alone is unsupported for throttle
			},
			PerCastThrottleMs: 1000,
			Operations: []model.OperationDefinition{{
				Operation: "damage", Target: "target", DamageType: "damage/physical",
				Amount: &model.GenericFormulaExpr{Op: "const", Value: floatPtr(1)},
			}},
		},
	}
	// Also attach an invalid cast_origin predicate on a pipeline modifier to collect.
	one := 1.0
	req.SharedProviders[0].Modifiers = []model.ModifierDefinition{{
		ModifierKey: "bad_pred",
		Kind:        "pipeline",
		Command:     "damage",
		Channel:     "all_damage",
		Stage:       "outgoing_pre_mitigation",
		Bucket:      "all_instances",
		ValuePolicy: "multiply",
		Value:       model.GenericFormulaExpr{Op: "const", Value: &one},
		Condition: &model.GenericFormulaExpr{
			Op: "read", Path: "damage.cast_origin.unknown_origin",
		},
	}}

	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected collect-all failure")
	}
	if !hasErrorPath(result.Result.Errors, "castOrigin") {
		t.Fatalf("missing castOrigin error: %+v", result.Result.Errors)
	}
	if !hasErrorPath(result.Result.Errors, "perCastThrottleMs") {
		t.Fatalf("missing perCastThrottleMs error: %+v", result.Result.Errors)
	}
	if !hasErrorPath(result.Result.Errors, "damage.cast_origin.unknown_origin") &&
		!hasErrorRef(result.Result.Errors, "damage.cast_origin.unknown_origin") {
		// path may be on condition.path; also check message/ref
		found := false
		for _, e := range result.Result.Errors {
			if e.Ref == "damage.cast_origin.unknown_origin" || e.Code == model.GenericErrUnknownTypeKey {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("missing cast_origin predicate error: %+v", result.Result.Errors)
		}
	}
	if len(result.Result.Errors) < 3 {
		t.Fatalf("expected collect-all (>=3), got %d: %+v", len(result.Result.Errors), result.Result.Errors)
	}
}

func TestCompileOmitsCastOriginAndThrottleBackwardCompatible(t *testing.T) {
	req := minimalValidCompileRequest()
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("legacy fixture should still compile: %+v", result.Result.Errors)
	}
	if result.Session.Abilities[0].CastOrigin != "" {
		t.Fatalf("omitted castOrigin should compile empty, got %q", result.Session.Abilities[0].CastOrigin)
	}
}

func hasErrorRef(errors []model.EngineError, ref string) bool {
	for _, e := range errors {
		if e.Ref == ref {
			return true
		}
	}
	return false
}
