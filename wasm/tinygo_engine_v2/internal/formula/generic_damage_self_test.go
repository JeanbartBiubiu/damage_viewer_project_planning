package formula

import (
	"strings"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestDamageSelfRequiresActualParticipants(t *testing.T) {
	reg := mustCompileFormula(t, model.GenericFormulaExpr{Op: "read", Path: model.FormulaPathDamageSelf})
	for _, ctx := range []GenericEvalContext{{}, {HasDamageContext: true}, {HasDamageParticipants: true}} {
		if _, err := reg.Eval(0, ctx); err == nil || !strings.Contains(err.Error(), model.FormulaPathDamageSelf) {
			t.Fatalf("missing participants must fail with path: %v", err)
		}
	}
	for _, self := range []bool{false, true} {
		value, err := reg.Eval(0, GenericEvalContext{HasDamageContext: true, HasDamageParticipants: true, DamageSelf: self})
		want := float64(0)
		if self {
			want = 1
		}
		if err != nil || value != want {
			t.Fatalf("self=%v got=%v err=%v", self, value, err)
		}
	}
}
