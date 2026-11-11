package formula

import (
	"errors"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestReceivedShieldFormulaRequiresBoundConditionContextAndKeepsZero(t *testing.T) {
	r := mustCompileFormula(t, model.GenericFormulaExpr{Op: "read", Path: "event.damage.linked_shield[shield/native_guard/value].absorbed"})
	if r.programs[0].Instr[0].ReadKind != ReadReceivedLinkedShieldAbsorbed || r.programs[0].Instr[0].ReadKey != "shield/native_guard/value" {
		t.Fatal(r.programs)
	}
	request := FactRequest{Kind: ReadReceivedLinkedShieldAbsorbed, Index: 7}
	context := GenericEvalContext{HasProviderContext: true, HasEventContext: true, HasEventDamageSnapshot: true,
		Facts: PreparedFacts([]FactRequest{request}, [2]PreparedFact{{}}, nil)}
	if _, err := r.evaluate(0, context); err == nil {
		t.Fatal("unbound read acquired permission")
	}
	r.programs[0].Instr[0].ReferenceBound, r.programs[0].Instr[0].RefIndex = true, 7
	for _, value := range []float64{0, 12.5} {
		context.Facts = PreparedFacts([]FactRequest{request}, [2]PreparedFact{{Value: value}}, nil)
		if got, err := r.evaluate(0, context); err != nil || got != value {
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
			c.Facts = FactView{}
		case "fact":
			c.Facts = PreparedFacts([]FactRequest{request}, [2]PreparedFact{{Err: errors.New("invalid receipt identity")}}, nil)
		}
		if _, err := r.evaluate(0, c); err == nil {
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
