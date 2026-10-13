package compile

import (
	"strings"
	"testing"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func compileIfConst(value float64) model.GenericFormulaExpr {
	return model.GenericFormulaExpr{Op: "const", Value: &value}
}

func compileIfExpr(condition, yes, no model.GenericFormulaExpr) model.GenericFormulaExpr {
	return model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{condition, yes, no}}
}

func TestCompileGenericIfNamedModifierKeepsBothBranchesChecked(t *testing.T) {
	r := minimalValidCompileRequest()
	r.SharedProviders[0].SkillKey = "test"
	r.TypeCatalog.Types = append(r.TypeCatalog.Types, model.TypeCatalogEntry{Key: "hp", Domain: "attribute"})
	r.Formulas = []model.NamedFormula{formuladefinition.FromExpr("branch", "test", compileIfExpr(compileIfConst(0), model.GenericFormulaExpr{Op: "read", Path: "target.attr.hp.current"}, compileIfConst(1)), nil)}
	r.SharedProviders[0].Modifiers = []model.ModifierDefinition{{ModifierKey: "if_modifier", Kind: "pipeline", Command: "damage", Channel: "all_damage", Stage: "outgoing_pre_mitigation", Bucket: "all_instances", ValuePolicy: "multiply", Value: model.GenericFormulaExpr{Op: "ref", Ref: "branch"}}}
	if result := CompileGeneric(r); !result.OK {
		t.Fatalf("named if rejected: %+v", result.Result.Errors)
	}
	for _, branch := range []int{1, 2} {
		args := []any{formuladefinition.Const(0), formuladefinition.Const(1), formuladefinition.Const(2)}
		args[branch] = map[string]any{"op": "unsupported"}
		r.Formulas[0].Expression = formuladefinition.Definition(nil, []any{formuladefinition.Stage("output", map[string]any{"op": "if", "args": args})}, "output")
		result := CompileGeneric(r)
		if result.OK || !strings.Contains(result.Result.Errors[0].Path, "/args/") {
			t.Fatalf("both branches must be checked: %+v", result.Result.Errors)
		}
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
