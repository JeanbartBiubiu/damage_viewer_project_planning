package formula

import (
	"math"
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func TestBorrowedContextMatchesValueEvaluationAndDoesNotWrite(t *testing.T) {
	registry := GenericRegistry{Programs: []GenericProgram{
		{Instr: []GenericInstr{{Op: GenericOpConst, Value: 7}}},
		{Instr: []GenericInstr{{Op: GenericOpRead, ReadKind: ReadSourceAttr, ReadKey: "amount.current"}}},
		{Instr: []GenericInstr{{Op: GenericOpRef, RefIndex: 0}, {Op: GenericOpRef, RefIndex: 1}, {Op: GenericOpAdd}}},
	}}
	for _, strict := range []bool{false, true} {
		for _, raw := range []map[string]model.AttributeSlotDef{{}, {"amount": {Current: 0}}, {"amount": {Current: math.Copysign(0, -1)}}, {"amount": {Current: 9}}, {"amount": {Current: math.Inf(1)}}} {
			ctx := GenericEvalContext{StrictReads: strict, SourceAttrs: attribute.FromMap(raw), ProviderState: model.BorrowNumericView(map[string]float64{"count": 4}), AuthoredCombatantKey: "source"}
			before := ctx
			for _, id := range []GenericProgramID{0, 1, 2, 99} {
				want, wantErr := registry.Eval(id, ctx)
				got, gotErr := registry.EvalContext(id, &ctx)
				if math.Float64bits(got) != math.Float64bits(want) || (gotErr == nil) != (wantErr == nil) || gotErr != nil && gotErr.Error() != wantErr.Error() || !reflect.DeepEqual(ctx, before) {
					t.Fatalf("id=%d borrowed=%v,%v value=%v,%v or context changed", id, got, gotErr, want, wantErr)
				}
			}
		}
	}
	if _, err := registry.EvalContext(0, nil); err == nil {
		t.Fatal("nil borrowed context was accepted")
	}
}

func TestBorrowedNamedContextStaysLiveAndAllocatesNothing(t *testing.T) {
	input := map[string]any{"key": "amount", "binding": map[string]any{"kind": "attribute", "object": "source", "attributeKey": "amount", "valueKind": "TOTAL", "view": "current_frame"}}
	def := model.NamedFormula{Scope: "skill", Key: "amount", SkillKey: "hit", Parameters: []model.FormulaParameter{}, Expression: formuladefinition.Definition([]any{input}, []any{formuladefinition.Stage("out", map[string]any{"op": "read", "inputKey": "amount"})}, "out")}
	var registry GenericRegistry
	CompileDeclaredNamedFormulas([]model.NamedFormula{def}, []string{"amount"}, &registry, func(c model.GenericErrCode, p, m, r string) { t.Fatal(c, p, m) })
	ctx := GenericEvalContext{SourceAttrs: attribute.FromMap(map[string]model.AttributeSlotDef{"amount": {Base: 4, Resolved: 4}})}
	allocations := testing.AllocsPerRun(20, func() {
		value, err := registry.EvalContext(0, &ctx)
		if err != nil || value != 4 {
			t.Fatal(value, err)
		}
	})
	if allocations != 0 {
		t.Fatalf("borrowed named context allocated %.1f objects", allocations)
	}
	ctx.SourceAttrs = ctx.SourceAttrs.With("amount", model.AttributeSlotDef{Base: 9, Resolved: 9})
	if value, err := registry.EvalContext(0, &ctx); err != nil || value != 9 {
		t.Fatal("borrowed context was retained", value, err)
	}
}

func TestBorrowedContextKeepsPerCallAndRecursiveInstructionBudget(t *testing.T) {
	large := make([]GenericInstr, MaxGenericTotalInstructions/2+1)
	for index := range large {
		large[index] = GenericInstr{Op: GenericOpConst, Value: 1}
		if index > 0 && index%2 == 0 {
			large[index] = GenericInstr{Op: GenericOpAdd}
		}
	}
	registry := GenericRegistry{Programs: []GenericProgram{{Instr: large}, {Instr: []GenericInstr{{Op: GenericOpRef, RefIndex: 0}, {Op: GenericOpRef, RefIndex: 0}}}}}
	ctx := GenericEvalContext{}
	for round := 0; round < 2; round++ {
		_, want := registry.Eval(1, ctx)
		_, got := registry.EvalContext(1, &ctx)
		if got == nil || want == nil || got.Error() != want.Error() {
			t.Fatal("recursive budget changed", got, want)
		}
		issue, ok := got.(*AuthoredEvaluationError)
		if !ok || issue.Issue.Code != "FORMULA_LIMIT" {
			t.Fatal("reference program did not exhaust the shared instruction budget", got)
		}
	}
	registry.Programs[0].Instr = []GenericInstr{{Op: GenericOpConst, Value: 8}}
	for round := 0; round < 2; round++ {
		if got, err := registry.EvalContext(0, &ctx); err != nil || got != 8 {
			t.Fatal("per-call budget did not reset", got, err)
		}
	}
}
