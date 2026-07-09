package formula

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func mustCompileFormula(t *testing.T, expr model.GenericFormulaExpr) GenericRegistry {
	t.Helper()
	var errors []model.EngineError
	addError := func(code model.GenericErrCode, path, message, ref string) {
		errors = append(errors, model.EngineError{Code: code, Path: path, Message: message, Ref: ref})
	}
	instr := CompileGenericFormula(expr, "test", map[string]model.GenericFormulaExpr{}, map[string]bool{}, addError)
	if len(errors) != 0 {
		t.Fatalf("compile errors: %+v", errors)
	}
	return GenericRegistry{
		Programs: []GenericProgram{{Key: "test", Instr: instr}},
		Index:    map[string]GenericProgramID{"test": 0},
	}
}

func TestGenericEvalConstAdd(t *testing.T) {
	a, b := 10.0, 32.0
	reg := mustCompileFormula(t, model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &a},
			{Op: "const", Value: &b},
		},
	})
	got, err := reg.Eval(0, GenericEvalContext{})
	if err != nil {
		t.Fatal(err)
	}
	if got != 42 {
		t.Fatalf("got %v want 42", got)
	}
}

func TestGenericEvalReadAbilityParam(t *testing.T) {
	reg := mustCompileFormula(t, model.GenericFormulaExpr{
		Op:   "read",
		Path: "ability.param.baseDamage",
	})
	got, err := reg.Eval(0, GenericEvalContext{AbilityParams: map[string]float64{"baseDamage": 100}})
	if err != nil {
		t.Fatal(err)
	}
	if got != 100 {
		t.Fatalf("got %v want 100", got)
	}
}

func TestGenericEvalReadAttr(t *testing.T) {
	reg := mustCompileFormula(t, model.GenericFormulaExpr{
		Op:   "read",
		Path: "target.attr.hp.current",
	})
	got, err := reg.Eval(0, GenericEvalContext{
		TargetAttrs: map[string]model.AttributeSlotDef{
			"hp": {Current: 900, Max: 1000},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got != 900 {
		t.Fatalf("got %v want 900", got)
	}
}

func TestGenericEvalDivByZero(t *testing.T) {
	a, b := 1.0, 0.0
	reg := mustCompileFormula(t, model.GenericFormulaExpr{
		Op: "div",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &a},
			{Op: "const", Value: &b},
		},
	})
	_, err := reg.Eval(0, GenericEvalContext{})
	if err == nil {
		t.Fatal("expected division by zero error")
	}
}

func TestGenericEvalNaNResult(t *testing.T) {
	reg := GenericRegistry{
		Programs: []GenericProgram{{Key: "nan", Instr: []GenericInstr{{Op: GenericOpConst, Value: math.NaN()}}}},
	}
	_, err := reg.Eval(0, GenericEvalContext{})
	if err == nil {
		t.Fatal("expected non-finite error")
	}
}
