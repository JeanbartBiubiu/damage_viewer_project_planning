package compile

import (
	"testing"

	"tinygo_engine_v2/internal/model"
)

func float64Ptr(v float64) *float64 { return &v }

func TestCompileC1AllowsMixedListenerDomains(t *testing.T) {
	req := minimalValidCompileRequest()
	req.TypeCatalog.Types = append(req.TypeCatalog.Types,
		model.TypeCatalogEntry{Key: "event/damage_instance", Domain: "event"},
		model.TypeCatalogEntry{Key: "ability/ultimate", Domain: "ability"},
		model.TypeCatalogEntry{Key: "damage_trait/on_hit", Domain: "damage_trait"},
		model.TypeCatalogEntry{Key: "tag/probe", Domain: "tag"},
	)
	req.Rules.Listeners = []model.ListenerDefinition{{
		ListenerKey: "mixed",
		EventMatcher: model.TypeMatcher{All: []string{
			"event/damage_instance",
			"ability/ultimate",
			"damage/physical",
			"damage_trait/on_hit",
		}},
		Operations: []model.OperationDefinition{{
			Operation: "emit_event",
			Target:    "target",
			EventType: "event/probe",
		}},
	}}
	req.TypeCatalog.Types = append(req.TypeCatalog.Types,
		model.TypeCatalogEntry{Key: "event/probe", Domain: "event"},
	)
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
}

func TestCompileC1RejectsInvalidDamageOperationTraits(t *testing.T) {
	req := minimalValidCompileRequest()
	req.TypeCatalog.Types = append(req.TypeCatalog.Types,
		model.TypeCatalogEntry{Key: "damage_trait/on_hit", Domain: "damage_trait"},
		model.TypeCatalogEntry{Key: "ability/ultimate", Domain: "ability"},
	)
	req.SharedProviders[0].Abilities[0].Operations[0].Types = []string{
		"damage_trait/on_hit",
		"ability/ultimate",
		"damage_trait/missing",
	}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected compile failure for invalid damage traits")
	}
	if !hasErrorCode(result.Result.Errors, model.GenericErrMatcherDomainError) {
		t.Fatalf("expected matcher domain error, got %+v", result.Result.Errors)
	}
	if !hasErrorCode(result.Result.Errors, model.GenericErrUnknownTypeKey) {
		t.Fatalf("expected unknown type key, got %+v", result.Result.Errors)
	}
}

func TestCompileC1AllowsAllDamageChannelAndSubtract(t *testing.T) {
	req := minimalValidCompileRequest()
	req.SharedProviders = append(req.SharedProviders, model.ProviderDefinition{
		ProviderKey: "item:c1_pipe",
		Kind:        "item",
		StableID:    "c1_pipe",
		Modifiers: []model.ModifierDefinition{{
			ModifierKey: "all_sub",
			Kind:        "pipeline",
			Command:     "damage",
			Channel:     "all_damage",
			Stage:       "outgoing_pre_mitigation",
			Bucket:      "all_instances",
			Priority:    0,
			ValuePolicy: "subtract",
			Value:       model.GenericFormulaExpr{Op: "const", Value: float64Ptr(5)},
		}},
	})
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
}

func TestCompileC1RejectsUnknownDamageTraitFormulaRead(t *testing.T) {
	req := minimalValidCompileRequest()
	req.TypeCatalog.Types = append(req.TypeCatalog.Types,
		model.TypeCatalogEntry{Key: "damage_trait/on_hit", Domain: "damage_trait"},
	)
	req.SharedProviders = append(req.SharedProviders, model.ProviderDefinition{
		ProviderKey: "item:c1_cond",
		Kind:        "item",
		StableID:    "c1_cond",
		Modifiers: []model.ModifierDefinition{{
			ModifierKey: "bad_trait",
			Kind:        "pipeline",
			Command:     "damage",
			Channel:     "all_damage",
			Stage:       "outgoing_pre_mitigation",
			Bucket:      "all_instances",
			Priority:    0,
			ValuePolicy: "multiply",
			Value:       model.GenericFormulaExpr{Op: "const", Value: float64Ptr(1)},
			Condition: &model.GenericFormulaExpr{
				Op:   "read",
				Path: "damage.trait.not_cataloged",
			},
		}},
	})
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected unknown damage.trait compile failure")
	}
	if !hasErrorCode(result.Result.Errors, model.GenericErrUnknownTypeKey) {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
}

func TestCompileC1RejectsUnknownDamageTypeFormulaRead(t *testing.T) {
	req := minimalValidCompileRequest()
	req.SharedProviders = append(req.SharedProviders, model.ProviderDefinition{
		ProviderKey: "item:c1_type",
		Kind:        "item",
		StableID:    "c1_type",
		Modifiers: []model.ModifierDefinition{{
			ModifierKey: "bad_type",
			Kind:        "pipeline",
			Command:     "damage",
			Channel:     "all_damage",
			Stage:       "outgoing_pre_mitigation",
			Bucket:      "all_instances",
			Priority:    0,
			ValuePolicy: "multiply",
			Value:       model.GenericFormulaExpr{Op: "const", Value: float64Ptr(1)},
			Condition: &model.GenericFormulaExpr{
				Op:   "read",
				Path: "damage.type.chaos",
			},
		}},
	})
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected unknown damage.type compile failure")
	}
	if !hasErrorCode(result.Result.Errors, model.GenericErrFormulaTypeError) {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
}

func TestCompileC1NormalizesDamageTraitsOntoCompiledOperation(t *testing.T) {
	req := minimalValidCompileRequest()
	req.TypeCatalog.Types = append(req.TypeCatalog.Types,
		model.TypeCatalogEntry{Key: "damage_trait/on_hit", Domain: "damage_trait"},
		model.TypeCatalogEntry{Key: "damage_trait/proc", Domain: "damage_trait"},
	)
	req.SharedProviders[0].Abilities[0].Operations[0].Types = []string{
		"damage_trait/on_hit",
		"damage_trait/proc",
	}
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	op := result.Session.Operations[0]
	if len(op.Types) != 2 || op.Types[0] != "damage_trait/on_hit" || op.Types[1] != "damage_trait/proc" {
		t.Fatalf("types=%v", op.Types)
	}
}
