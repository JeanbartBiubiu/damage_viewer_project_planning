package formula

import (
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestCompileDamageCastOriginAndAbilityTypeReads(t *testing.T) {
	var errors []model.EngineError
	addError := func(code model.GenericErrCode, path, message, ref string) {
		errors = append(errors, model.EngineError{Code: code, Path: path, Message: message, Ref: ref})
	}
	cases := []struct {
		path string
		kind GenericReadKind
		key  string
	}{
		{"damage.cast_origin.champion", ReadDamageCastOrigin, "champion"},
		{"damage.cast_origin.item", ReadDamageCastOrigin, "item"},
		{"damage.cast_origin.pet", ReadDamageCastOrigin, "pet"},
		{"damage.cast_origin.innate", ReadDamageCastOrigin, "innate"},
		{"damage.ability_type.basic_attack", ReadDamageAbilityType, "basic_attack"},
		{"damage.ability_type.spell", ReadDamageAbilityType, "spell"},
	}
	for _, tc := range cases {
		errors = nil
		instr := CompileGenericFormula(
			model.GenericFormulaExpr{Op: "read", Path: tc.path},
			"cond", map[string]model.GenericFormulaExpr{}, map[string]bool{}, addError,
		)
		if len(errors) != 0 {
			t.Fatalf("%s errors=%+v", tc.path, errors)
		}
		if len(instr) != 1 || instr[0].ReadKind != tc.kind || instr[0].ReadKey != tc.key {
			t.Fatalf("%s instr=%+v", tc.path, instr)
		}
	}
}

func TestCompileRejectsMalformedCastOriginAndAbilityTypePaths(t *testing.T) {
	var errors []model.EngineError
	addError := func(code model.GenericErrCode, path, message, ref string) {
		errors = append(errors, model.EngineError{Code: code})
	}
	for _, path := range []string{
		"damage.cast_origin.",
		"damage.cast_origin.foo/bar",
		"damage.ability_type.",
		"damage.ability_type.a.b",
	} {
		errors = nil
		CompileGenericFormula(
			model.GenericFormulaExpr{Op: "read", Path: path},
			"cond", map[string]model.GenericFormulaExpr{}, map[string]bool{}, addError,
		)
		if len(errors) == 0 {
			t.Fatalf("expected reject for %s", path)
		}
	}
}

func TestEvalDamageCastOriginAndAbilityType(t *testing.T) {
	reg := mustCompileFormula(t, model.GenericFormulaExpr{Op: "read", Path: "damage.cast_origin.champion"})
	got, err := reg.Eval(0, GenericEvalContext{
		HasDamageContext: true,
		DamageCastOrigin: "champion",
	})
	if err != nil || got != 1 {
		t.Fatalf("cast_origin match got=%v err=%v", got, err)
	}
	got, err = reg.Eval(0, GenericEvalContext{
		HasDamageContext: true,
		DamageCastOrigin: "pet",
	})
	if err != nil || got != 0 {
		t.Fatalf("cast_origin miss got=%v err=%v", got, err)
	}
	got, err = reg.Eval(0, GenericEvalContext{HasDamageContext: true})
	if err != nil || got != 0 {
		t.Fatalf("empty origin got=%v err=%v", got, err)
	}
	if _, err := reg.Eval(0, GenericEvalContext{}); err == nil {
		t.Fatal("expected fail closed without damage context for cast_origin")
	}

	reg = mustCompileFormula(t, model.GenericFormulaExpr{Op: "read", Path: "damage.ability_type.basic_attack"})
	got, err = reg.Eval(0, GenericEvalContext{
		HasDamageContext:   true,
		DamageAbilityTypes: []string{"ability/basic_attack", "ability/spell"},
	})
	if err != nil || got != 1 {
		t.Fatalf("ability_type match got=%v err=%v", got, err)
	}
	got, err = reg.Eval(0, GenericEvalContext{
		HasDamageContext:   true,
		DamageAbilityTypes: []string{"ability/spell"},
	})
	if err != nil || got != 0 {
		t.Fatalf("ability_type miss got=%v err=%v", got, err)
	}
	got, err = reg.Eval(0, GenericEvalContext{HasDamageContext: true})
	if err != nil || got != 0 {
		t.Fatalf("no ability types got=%v err=%v", got, err)
	}
	if _, err := reg.Eval(0, GenericEvalContext{}); err == nil {
		t.Fatal("expected fail closed without damage context for ability_type")
	}
}
