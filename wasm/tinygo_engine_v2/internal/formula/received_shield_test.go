package formula

import (
	"errors"
	"testing"

	"tinygo_engine_v2/internal/model"
)

type testReceivedShieldReader struct {
	amount float64
	fail   bool
}

func (r testReceivedShieldReader) ReceivedLinkedShieldAbsorbed(index uint16) (float64, error) {
	if r.fail || index != 7 {
		return 0, errors.New("invalid receipt identity")
	}
	return r.amount, nil
}

func TestReceivedShieldFormulaRequiresBoundConditionContextAndKeepsZero(t *testing.T) {
	r := mustCompileFormula(t, model.GenericFormulaExpr{Op: "read", Path: "event.damage.linked_shield[shield/native_guard/value].absorbed"})
	if r.Programs[0].Instr[0].ReadKind != ReadReceivedLinkedShieldAbsorbed || r.Programs[0].Instr[0].ReadKey != "shield/native_guard/value" {
		t.Fatal(r.Programs)
	}
	context := GenericEvalContext{HasProviderContext: true, HasEventContext: true, HasEventDamageSnapshot: true, ReceivedShieldReader: testReceivedShieldReader{}}
	if _, err := r.Eval(0, context); err == nil {
		t.Fatal("unbound read acquired permission")
	}
	r.Programs[0].Instr[0].ReferenceBound, r.Programs[0].Instr[0].RefIndex = true, 7
	for _, value := range []float64{0, 12.5} {
		context.ReceivedShieldReader = testReceivedShieldReader{amount: value}
		if got, err := r.Eval(0, context); err != nil || got != value {
			t.Fatal(value, got, err)
		}
	}
	for _, missing := range []string{"provider", "event", "damage", "reader", "fact"} {
		c := context
		switch missing {
		case "provider":
			c.HasProviderContext = false
		case "event":
			c.HasEventContext = false
		case "damage":
			c.HasEventDamageSnapshot = false
		case "reader":
			c.ReceivedShieldReader = nil
		case "fact":
			c.ReceivedShieldReader = testReceivedShieldReader{fail: true}
		}
		if _, err := r.Eval(0, c); err == nil {
			t.Fatal("missing received fact became a zero", missing)
		}
	}
}

func TestReceivedShieldFormulaRejectsIncompleteOrDynamicDefinitionPaths(t *testing.T) {
	for _, path := range []string{"event.damage.linked_shield[].absorbed", "event.damage.linked_shield[bad key].absorbed", "event.damage.linked_shield[a[b]].absorbed", "event.damage.linked_shield[x].present"} {
		failed := false
		code := CompileGenericFormula(model.GenericFormulaExpr{Op: "read", Path: path}, "read", nil, nil, func(model.GenericErrCode, string, string, string) { failed = true })
		if !failed || len(code) != 0 {
			t.Fatal("invalid static shield path compiled", path, code)
		}
	}
}
