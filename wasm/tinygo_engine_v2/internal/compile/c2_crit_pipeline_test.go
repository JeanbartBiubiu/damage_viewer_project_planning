package compile

import (
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestCompileC2AllowsCritStages(t *testing.T) {
	req := minimalValidCompileRequest()
	stages := []string{
		"crit_chance_pre_settlement",
		"crit_multiplier_forced_branch",
		"crit_multiplier_natural_branch",
	}
	mods := make([]model.ModifierDefinition, 0, len(stages))
	for i, stage := range stages {
		mods = append(mods, model.ModifierDefinition{
			ModifierKey: "crit_" + stage,
			Kind:        "pipeline",
			Command:     "crit",
			Channel:     "all_damage",
			Stage:       stage,
			Bucket:      "all_instances",
			Priority:    i,
			ValuePolicy: "multiply",
			Value:       model.GenericFormulaExpr{Op: "const", Value: float64Ptr(1)},
		})
	}
	req.SharedProviders = append(req.SharedProviders, model.ProviderDefinition{
		ProviderKey: "item:c2_crit",
		Kind:        "item",
		StableID:    "c2_crit",
		Modifiers:   mods,
	})
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
}

func TestCompileC2AllowsIncomingCritPartStage(t *testing.T) {
	req := minimalValidCompileRequest()
	req.SharedProviders = append(req.SharedProviders, model.ProviderDefinition{
		ProviderKey: "item:c2_randuin",
		Kind:        "item",
		StableID:    "c2_randuin",
		Modifiers: []model.ModifierDefinition{{
			ModifierKey: "crit_part_mul",
			Kind:        "pipeline",
			Command:     "damage",
			Channel:     "all_damage",
			Stage:       "incoming_crit_part_post_mitigation",
			Bucket:      "all_instances",
			Priority:    0,
			ValuePolicy: "multiply",
			Value:       model.GenericFormulaExpr{Op: "const", Value: float64Ptr(0.75)},
		}},
	})
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
}

func TestCompileC2RejectsCritSubtractValuePolicy(t *testing.T) {
	req := minimalValidCompileRequest()
	req.SharedProviders = append(req.SharedProviders, model.ProviderDefinition{
		ProviderKey: "item:c2_bad_crit",
		Kind:        "item",
		StableID:    "c2_bad_crit",
		Modifiers: []model.ModifierDefinition{{
			ModifierKey: "bad",
			Kind:        "pipeline",
			Command:     "crit",
			Channel:     "all_damage",
			Stage:       "crit_chance_pre_settlement",
			Bucket:      "all_instances",
			Priority:    0,
			ValuePolicy: "subtract",
			Value:       model.GenericFormulaExpr{Op: "const", Value: float64Ptr(0.1)},
		}},
	})
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected compile failure for crit subtract")
	}
	if !hasErrorCode(result.Result.Errors, model.GenericErrUnknownRef) {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
}

func TestCompileC2RejectsIncomingCritPartSubtract(t *testing.T) {
	req := minimalValidCompileRequest()
	req.SharedProviders = append(req.SharedProviders, model.ProviderDefinition{
		ProviderKey: "item:c2_bad_part",
		Kind:        "item",
		StableID:    "c2_bad_part",
		Modifiers: []model.ModifierDefinition{{
			ModifierKey: "bad",
			Kind:        "pipeline",
			Command:     "damage",
			Channel:     "all_damage",
			Stage:       "incoming_crit_part_post_mitigation",
			Bucket:      "all_instances",
			Priority:    0,
			ValuePolicy: "subtract",
			Value:       model.GenericFormulaExpr{Op: "const", Value: float64Ptr(5)},
		}},
	})
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected compile failure for incoming_crit_part subtract")
	}
	if !hasErrorCode(result.Result.Errors, model.GenericErrUnknownRef) {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
}

func TestCompileC2RejectsUnknownCritStage(t *testing.T) {
	req := minimalValidCompileRequest()
	req.SharedProviders = append(req.SharedProviders, model.ProviderDefinition{
		ProviderKey: "item:c2_bad_stage",
		Kind:        "item",
		StableID:    "c2_bad_stage",
		Modifiers: []model.ModifierDefinition{{
			ModifierKey: "bad",
			Kind:        "pipeline",
			Command:     "crit",
			Channel:     "basic_damage",
			Stage:       "crit_post_mitigation",
			Bucket:      "all_instances",
			Priority:    0,
			ValuePolicy: "override",
			Value:       model.GenericFormulaExpr{Op: "const", Value: float64Ptr(1)},
		}},
	})
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected compile failure for unknown crit stage")
	}
	if !hasErrorCode(result.Result.Errors, model.GenericErrUnknownRef) {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
}

func TestCompileC2RejectsUnknownPipelineCommand(t *testing.T) {
	req := minimalValidCompileRequest()
	req.SharedProviders = append(req.SharedProviders, model.ProviderDefinition{
		ProviderKey: "item:c2_bad_cmd",
		Kind:        "item",
		StableID:    "c2_bad_cmd",
		Modifiers: []model.ModifierDefinition{{
			ModifierKey: "bad",
			Kind:        "pipeline",
			Command:     "heal",
			Channel:     "all_damage",
			Stage:       "outgoing_pre_mitigation",
			Bucket:      "all_instances",
			Priority:    0,
			ValuePolicy: "multiply",
			Value:       model.GenericFormulaExpr{Op: "const", Value: float64Ptr(1)},
		}},
	})
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected compile failure for unknown command")
	}
	if !hasErrorCode(result.Result.Errors, model.GenericErrUnknownRef) {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
}
