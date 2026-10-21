package formula

import (
	"testing"
	"tinygo_engine_v2/internal/model"
)

func TestAttackStartCounterReadNeverFallsBackToCurrentState(t *testing.T) {
	r := mustCompileFormula(t, model.GenericFormulaExpr{Op: "read", Path: "use.provider_state_before.hits"})
	ctx := GenericEvalContext{HasProviderContext: true, ProviderState: map[string]float64{"hits": 2}, ProviderStateDefaults: map[string]float64{"hits": 2}}
	if _, err := r.Eval(0, ctx); err == nil {
		t.Fatal("missing capture used mutable state")
	}
	ctx.UseProviderStateBefore = []ProviderStateBeforeValue{{StateKey: "other", Value: 2}}
	if _, err := r.Eval(0, ctx); err == nil {
		t.Fatal("foreign field used as capture")
	}
	ctx.UseProviderStateBefore = []ProviderStateBeforeValue{{StateKey: "hits", Value: 0}}
	if value, err := r.Eval(0, ctx); err != nil || value != 0 {
		t.Fatal(value, err)
	}
}
