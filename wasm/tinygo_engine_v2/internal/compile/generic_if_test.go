package compile

import (
	"strings"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func compileIfConst(value float64) model.GenericFormulaExpr {
	return model.GenericFormulaExpr{Op: "const", Value: &value}
}

func compileIfExpr(condition, yes, no model.GenericFormulaExpr) model.GenericFormulaExpr {
	return model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{condition, yes, no}}
}

func TestCompileGenericIfNamedModifierKeepsBothBranchesChecked(t *testing.T) {
	r := minimalValidCompileRequest()
	r.Formulas = []model.NamedFormula{{Key: "branch", Expression: compileIfExpr(
		compileIfConst(0), model.GenericFormulaExpr{Op: "read", Path: "target.attr.hp.current"}, compileIfConst(1))}}
	r.SharedProviders[0].Modifiers = []model.ModifierDefinition{{
		ModifierKey: "if_modifier", Kind: "pipeline", Command: "damage", Channel: "all_damage",
		Stage: "outgoing_pre_mitigation", Bucket: "all_instances", ValuePolicy: "multiply",
		Value: model.GenericFormulaExpr{Op: "ref", Ref: "branch"},
	}}
	if result := CompileGeneric(r); !result.OK {
		t.Fatalf("named if rejected: %+v", result.Result.Errors)
	}

	r.Formulas[0].Expression = compileIfExpr(compileIfConst(0),
		model.GenericFormulaExpr{Op: "read", Path: "history.invalid"},
		model.GenericFormulaExpr{Op: "read", Path: "ability.state.invalid"})
	result := CompileGeneric(r)
	if result.OK {
		t.Fatal("invalid branches accepted")
	}
	badPaths := 0
	for _, issue := range result.Result.Errors {
		if issue.Code == model.GenericErrFormulaTypeError && strings.Contains(issue.Path, ".args[") {
			badPaths++
		}
	}
	if badPaths < 2 {
		t.Fatalf("both branches must be checked: %+v", result.Result.Errors)
	}
}

func TestCompileGenericIfUnselectedDamageSelfStillRejectsWrongContext(t *testing.T) {
	r := minimalValidCompileRequest()
	r.SharedProviders[0].Modifiers = []model.ModifierDefinition{{
		ModifierKey: "if_attr", Kind: "attribute", Target: "attack_damage", ValuePolicy: "add",
		Value: compileIfExpr(compileIfConst(0),
			model.GenericFormulaExpr{Op: "read", Path: model.FormulaPathDamageSelf}, compileIfConst(1)),
	}}
	result := CompileGeneric(r)
	if result.OK {
		t.Fatal("unselected damage.self accepted outside damage context")
	}
	found := false
	for _, issue := range result.Result.Errors {
		if issue.Ref == model.FormulaPathDamageSelf {
			found = true
		}
	}
	if !found {
		t.Fatalf("missing static context error: %+v", result.Result.Errors)
	}
}
