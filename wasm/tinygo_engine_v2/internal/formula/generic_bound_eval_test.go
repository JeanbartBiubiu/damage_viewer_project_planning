package formula

import (
	"math"
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/expression"
	"tinygo_engine_v2/internal/inputbinding"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func boundProgram(t *testing.T, lazy bool) (GenericRegistry, *inputbinding.Plan) {
	t.Helper()
	binding := expression.Binding{Kind: "context", ContextKey: "amount"}
	input := map[string]any{"key": "amount", "binding": map[string]any{"kind": "context", "contextKey": "amount"}}
	var expr any = map[string]any{"op": "read", "inputKey": "amount"}
	if lazy {
		expr = map[string]any{"op": "if", "args": []any{map[string]any{"op": "const", "value": "1"}, map[string]any{"op": "const", "value": "8"}, expr}}
	}
	raw := formuladefinition.Definition([]any{input}, []any{formuladefinition.Stage("out", expr)}, "out")
	program, issue := expression.CompileDefinition(raw, []any{input["binding"]})
	if issue != nil {
		t.Fatal(issue)
	}
	plan, issue := inputbinding.Bind(program, []expression.Binding{binding})
	if issue != nil {
		t.Fatal(issue)
	}
	return GenericRegistry{Programs: []GenericProgram{{Key: "bound", Authored: program}}}, plan
}

func TestBoundEvaluationMatchesFrozenContextReads(t *testing.T) {
	for _, lazy := range []bool{false, true} {
		registry, plan := boundProgram(t, lazy)
		for _, scalar := range []inputbinding.Scalar{{}, {Value: math.Copysign(0, -1), Present: true}, {Value: 9, Present: true}, {Value: math.Inf(1), Present: true}} {
			values := []inputbinding.Value{{Number: scalar}}
			reader, issue := plan.Reader(values)
			if issue != nil {
				t.Fatal(issue)
			}
			want, wantErr := registry.Eval(0, GenericEvalContext{ReadInput: reader})
			got, gotErr := registry.EvalBound(0, plan, values)
			if math.Float64bits(want) != math.Float64bits(got) || !reflect.DeepEqual(wantErr, gotErr) || values[0].Number != scalar {
				t.Fatal(lazy, scalar, got, gotErr, want, wantErr)
			}
		}
	}
}

func TestBoundEvaluationUsesSharedValidationAndStackInputs(t *testing.T) {
	registry, plan := boundProgram(t, false)
	if count := testing.AllocsPerRun(100, func() {
		var values [8]inputbinding.Value
		values[0].Number = inputbinding.Scalar{Value: 3, Present: true}
		got, err := registry.EvalBound(0, plan, values[:1])
		if err != nil || got != 3 {
			t.Fatal(got, err)
		}
	}); count != 0 {
		t.Fatal("bound stack inputs allocated", count)
	}
	charge := registry.Programs[0].Authored.Stats().Instructions
	spent := MaxGenericTotalInstructions - charge
	if _, err := registry.programForEvaluation(0, 1, &spent); err != nil || spent != MaxGenericTotalInstructions {
		t.Fatal("incorrect shared charge", spent, err)
	}
	if _, err := registry.programForEvaluation(0, 1, &spent); err == nil || spent != MaxGenericTotalInstructions {
		t.Fatal("instruction budget bypassed", spent, err)
	}
	if _, err := registry.EvalBound(1, plan, nil); err == nil {
		t.Fatal("out of range program accepted")
	}
	registry.Programs[0].Instr = []GenericInstr{{Op: GenericOpConst, Value: 1}}
	if _, err := registry.EvalBound(0, plan, nil); err == nil {
		t.Fatal("mixed authored program accepted")
	}
	registry.Programs[0].Instr = nil
	if _, err := registry.EvalBound(0, nil, nil); err == nil {
		t.Fatal("missing binding accepted")
	}
}
