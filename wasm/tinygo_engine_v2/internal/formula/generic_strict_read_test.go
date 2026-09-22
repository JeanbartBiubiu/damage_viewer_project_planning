package formula

import (
	"testing"
	"tinygo_engine_v2/internal/model"
)

func TestStrictReadPreservesResolvedZeroAndRejectsMissingInput(t *testing.T) {
	ctx := GenericEvalContext{StrictReads: true, SourceAttrs: map[string]model.AttributeSlotDef{"ratio": {Base: 1, Current: 1, Max: 1, Resolved: 0}}, AbilityParams: map[string]float64{"zero": 0}}
	value, err := evalRead(ReadSourceAttr, "ratio.resolved", ctx)
	if err != nil || value != 0 {
		t.Fatalf("resolved zero=%v err=%v", value, err)
	}
	value, err = evalRead(ReadAbilityParam, "zero", ctx)
	if err != nil || value != 0 {
		t.Fatalf("parameter zero=%v err=%v", value, err)
	}
	if _, err := evalRead(ReadSourceAttr, "missing.resolved", ctx); err == nil {
		t.Fatal("missing attribute silently accepted")
	}
	if _, err := evalRead(ReadAbilityParam, "missing", ctx); err == nil {
		t.Fatal("missing parameter silently accepted")
	}
}
