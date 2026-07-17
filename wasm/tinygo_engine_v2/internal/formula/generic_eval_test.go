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

func TestGenericEvalResourceCurrentAndMax(t *testing.T) {
	ctx := GenericEvalContext{
		SourceResources: map[string]model.ResourceSlotDef{
			"mana": {Current: 40, Max: 100},
		},
	}
	cases := []struct {
		path string
		want float64
	}{
		{"source.resource.mana", 40},
		{"source.resource.mana.current", 40},
		{"source.resource.mana.max", 100},
	}
	for _, tc := range cases {
		reg := mustCompileFormula(t, model.GenericFormulaExpr{Op: "read", Path: tc.path})
		got, err := reg.Eval(0, ctx)
		if err != nil {
			t.Fatalf("%s: %v", tc.path, err)
		}
		if got != tc.want {
			t.Fatalf("%s=%v want %v", tc.path, got, tc.want)
		}
	}
}

func TestGenericEvalEventSnapshotRequiresContext(t *testing.T) {
	reg := mustCompileFormula(t, model.GenericFormulaExpr{Op: "read", Path: "event.entry_target.attr.hp.current"})
	if _, err := reg.Eval(0, GenericEvalContext{}); err == nil {
		t.Fatal("expected event context error")
	}
}

func TestGenericEvalEventSnapshotReads(t *testing.T) {
	regEntry := mustCompileFormula(t, model.GenericFormulaExpr{Op: "read", Path: "event.entry_target.attr.hp.current"})
	regEmit := mustCompileFormula(t, model.GenericFormulaExpr{Op: "read", Path: "event.target.attr.hp.current"})
	regRes := mustCompileFormula(t, model.GenericFormulaExpr{Op: "read", Path: "event.source.resource.mana.max"})
	ctx := GenericEvalContext{
		HasEventContext: true,
		EventEntryTargetAttrs: map[string]model.AttributeSlotDef{
			"hp": {Current: 1000, Max: 1000, Resolved: 1000},
		},
		EventTargetAttrs: map[string]model.AttributeSlotDef{
			"hp": {Current: 900, Max: 1000, Resolved: 900},
		},
		EventSourceResources: map[string]model.ResourceSlotDef{
			"mana": {Current: 10, Max: 80},
		},
	}
	got, err := regEntry.Eval(0, ctx)
	if err != nil || got != 1000 {
		t.Fatalf("entry hp=%v err=%v want 1000", got, err)
	}
	got, err = regEmit.Eval(0, ctx)
	if err != nil || got != 900 {
		t.Fatalf("emit hp=%v err=%v want 900", got, err)
	}
	got, err = regRes.Eval(0, ctx)
	if err != nil || got != 80 {
		t.Fatalf("mana max=%v err=%v want 80", got, err)
	}
}

func TestGenericEvalDamageAmountRequiresContext(t *testing.T) {
	reg := mustCompileFormula(t, model.GenericFormulaExpr{Op: "read", Path: "damage.amount"})
	if _, err := reg.Eval(0, GenericEvalContext{}); err == nil {
		t.Fatal("expected structural failure without damage context")
	}
	got, err := reg.Eval(0, GenericEvalContext{HasDamageContext: true, DamageAmount: 85})
	if err != nil {
		t.Fatal(err)
	}
	if got != 85 {
		t.Fatalf("got %v want 85", got)
	}
}
