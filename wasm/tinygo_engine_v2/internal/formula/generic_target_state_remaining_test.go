package formula

import (
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestTargetStateRemainingReadRequiresBindingAndActualContext(t *testing.T) {
	path := "provider.target_state_remaining_ms.mark"
	kind, key, valid := parseReadPath(path)
	if !valid || kind != ReadProviderTargetStateRemainingMs || key != "mark" {
		t.Fatal(kind, key, valid)
	}
	for _, suffix := range []string{"", "mark.other", "mark[other]", "mark key"} {
		if _, _, ok := parseReadPath("provider.target_state_remaining_ms." + suffix); ok {
			t.Fatal("accepted malformed state key", suffix)
		}
	}
	read := GenericInstr{Op: GenericOpRead, ReadKind: kind, ReadKey: key, ReferenceBound: true}
	ctx := GenericEvalContext{HasProviderContext: true, HasTargetStateRemainingContext: true,
		ProviderTargetState: map[string]float64{"mark": 1}, TargetStateExpireAt: map[string]int64{"mark": 6000}}
	for _, remaining := range []int64{0, 1, 999, 1000, 1249, 1250} {
		ctx.TargetStateRemainingNowMs = 6000 - remaining
		value, err := evalInstructionRead(read, &ctx)
		if err != nil || value != float64(remaining) {
			t.Fatal(remaining, value, err)
		}
	}
	ctx.ProviderTargetState["mark"] = 0
	if value, err := evalInstructionRead(read, &ctx); err != nil || value != 0 {
		t.Fatal("cleared marker remained active", value, err)
	}
	for _, missing := range []string{"binding", "provider", "timer_context"} {
		copy, view := read, ctx
		switch missing {
		case "binding":
			copy.ReferenceBound = false
		case "provider":
			view.HasProviderContext = false
		case "timer_context":
			view.HasTargetStateRemainingContext = false
		}
		if _, err := evalInstructionRead(copy, &view); err == nil {
			t.Fatal("missing context returned a fabricated zero", missing)
		}
	}
	var issues []model.EngineError
	CompileGenericFormula(model.GenericFormulaExpr{Op: "read", Path: path}, "condition", nil, nil,
		func(code model.GenericErrCode, path, message, ref string) {
			issues = append(issues, model.EngineError{Code: code})
		})
	if len(issues) != 0 {
		t.Fatal(issues)
	}
}
