package compile

import (
	"strings"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestDamageSelfRejectedInAttributeModifiers(t *testing.T) {
	for _, kind := range []string{"", "attribute"} {
		for _, named := range []bool{false, true} {
			for _, field := range []string{"value", "condition"} {
				r := minimalValidCompileRequest()
				read := model.GenericFormulaExpr{Op: "read", Path: model.FormulaPathDamageSelf}
				if named {
					r.Formulas = append(r.Formulas, model.NamedFormula{Key: "is_self", Expression: read})
					read = model.GenericFormulaExpr{Op: "ref", Ref: "is_self"}
				}
				one := 1.0
				mod := model.ModifierDefinition{ModifierKey: "self_probe", Kind: kind, Target: "attack_damage", ValuePolicy: "add", Value: model.GenericFormulaExpr{Op: "const", Value: &one}}
				if field == "value" {
					mod.Value = read
				} else {
					mod.Condition = &read
				}
				r.SharedProviders[0].Modifiers = []model.ModifierDefinition{mod}
				result := CompileGeneric(r)
				found := false
				for _, err := range result.Result.Errors {
					if strings.HasSuffix(err.Path, "."+field) && err.Ref == model.FormulaPathDamageSelf {
						found = true
					}
				}
				if result.OK || !found {
					t.Fatalf("kind=%q named=%v field=%s errors=%+v", kind, named, field, result.Result.Errors)
				}
			}
		}
	}
}
