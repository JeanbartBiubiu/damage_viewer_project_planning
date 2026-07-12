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

func TestGenericEvalCompareOperatorsReturnNumericBooleans(t *testing.T) {
	cases := []struct {
		op   string
		l, r float64
		want float64
	}{
		{"eq", 1, 1, 1},
		{"eq", 1, 2, 0},
		{"ne", 1, 2, 1},
		{"lt", 1, 2, 1},
		{"lte", 2, 2, 1},
		{"gt", 3, 2, 1},
		{"gte", 2, 3, 0},
	}
	for _, tc := range cases {
		l, r := tc.l, tc.r
		reg := mustCompileFormula(t, model.GenericFormulaExpr{
			Op: tc.op,
			Args: []model.GenericFormulaExpr{
				{Op: "const", Value: &l},
				{Op: "const", Value: &r},
			},
		})
		got, err := reg.Eval(0, GenericEvalContext{})
		if err != nil {
			t.Fatalf("%s: %v", tc.op, err)
		}
		if got != tc.want {
			t.Fatalf("%s(%v,%v)=%v want %v", tc.op, tc.l, tc.r, got, tc.want)
		}
	}
}

func TestGenericEvalProviderStateRequiresContext(t *testing.T) {
	reg := mustCompileFormula(t, model.GenericFormulaExpr{Op: "read", Path: "provider.state.hits"})
	if _, err := reg.Eval(0, GenericEvalContext{}); err == nil {
		t.Fatal("expected provider context error")
	}
	got, err := reg.Eval(0, GenericEvalContext{
		HasProviderContext: true,
		ProviderState:      map[string]float64{"hits": 3},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got != 3 {
		t.Fatalf("got=%v want 3", got)
	}
}

func TestGenericEvalProviderTargetState(t *testing.T) {
	reg := mustCompileFormula(t, model.GenericFormulaExpr{Op: "read", Path: "provider.target_state.hits"})
	got, err := reg.Eval(0, GenericEvalContext{
		HasProviderContext:  true,
		ProviderTargetState: map[string]float64{"hits": 2},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got != 2 {
		t.Fatalf("got=%v want 2", got)
	}
}
