package expression

import (
	"encoding/json"
	"fmt"
	"math"
	"testing"
)

func fixed(value string) any { return map[string]any{"op": "const", "value": value} }
func operation(op string, values ...any) any {
	return map[string]any{"op": op, "args": values}
}
func definition(expression any) any {
	return map[string]any{"inputs": []any{}, "stages": []any{map[string]any{"key": "result", "name": "结果", "expression": expression}}, "outputStageKey": "result"}
}

func compileForTest(t *testing.T, raw any, allowed []any) *Program {
	t.Helper()
	p, issue := CompileDefinition(raw, allowed)
	if issue != nil {
		t.Fatal(issue)
	}
	return p
}

func TestCompileSharedContractCases(t *testing.T) {
	var corpus struct {
		Cases []struct {
			Name            string
			Definition      any
			AllowedBindings []any
			Expected        *ContractIssue
		}
	}
	if err := json.Unmarshal([]byte(contractCasesJSON), &corpus); err != nil {
		t.Fatal(err)
	}
	for _, sample := range corpus.Cases {
		t.Run(sample.Name, func(t *testing.T) {
			p, issue := CompileDefinition(sample.Definition, sample.AllowedBindings)
			if sample.Expected == nil {
				if issue != nil || p == nil {
					t.Fatalf("unexpected compile issue: %+v", issue)
				}
			} else if issue == nil || *issue != *sample.Expected || p != nil {
				t.Fatalf("got %+v, expected %+v", issue, sample.Expected)
			}
		})
	}
}

func TestProgramArithmeticAndDynamicErrors(t *testing.T) {
	for _, sample := range []struct {
		name string
		expr any
		want float64
		code string
	}{
		{"add", operation("add", fixed("2"), fixed("3")), 5, ""},
		{"sub", operation("sub", fixed("2"), fixed("3")), -1, ""},
		{"mul", operation("mul", fixed("2"), fixed("3")), 6, ""},
		{"div", operation("div", fixed("2"), fixed("3")), 2.0 / 3, ""},
		{"min", operation("min", fixed("2"), fixed("3")), 2, ""},
		{"max", operation("max", fixed("2"), fixed("3")), 3, ""},
		{"eq", operation("eq", fixed("3"), fixed("3")), 1, ""},
		{"ne", operation("ne", fixed("3"), fixed("3")), 0, ""},
		{"lt", operation("lt", fixed("2"), fixed("3")), 1, ""},
		{"lte", operation("lte", fixed("3"), fixed("3")), 1, ""},
		{"gt", operation("gt", fixed("2"), fixed("3")), 0, ""},
		{"gte", operation("gte", fixed("3"), fixed("3")), 1, ""},
		{"floor", operation("floor", fixed("-1.5")), -2, ""},
		{"ceil", operation("ceil", fixed("-1.5")), -1, ""},
		{"trunc", operation("trunc", fixed("-1.5")), -1, ""},
		{"clamp", operation("clamp", fixed("5"), fixed("0"), fixed("3")), 3, ""},
		{"clamp_invalid", operation("clamp", fixed("5"), fixed("3"), fixed("0")), 0, "FORMULA_INVALID_BOUNDS"},
		{"zero", fixed("0"), 0, ""},
		{"divide_zero", operation("div", fixed("2"), fixed("0")), 0, "FORMULA_DIVISION_BY_ZERO"},
		{"lazy_divide", operation("if", fixed("1"), fixed("7"), operation("div", fixed("1"), fixed("0"))), 7, ""},
		{"lazy_else", operation("if", fixed("0"), operation("div", fixed("1"), fixed("0")), fixed("8")), 8, ""},
		{"overflow", operation("mul", fixed("1"+string(makeDigits(308))), fixed("10")), 0, "FORMULA_NON_FINITE"},
	} {
		t.Run(sample.name, func(t *testing.T) {
			p := compileForTest(t, definition(sample.expr), nil)
			got, issue := p.Evaluate(nil)
			if sample.code != "" {
				if issue == nil || issue.Code != sample.code || issue.Path != "/stages/0/expression" {
					t.Fatalf("got %+v, want %s", issue, sample.code)
				}
				return
			}
			if issue != nil || math.Abs(got.Value-sample.want) > math.Max(1e-9, 1e-12*math.Max(math.Abs(got.Value), math.Abs(sample.want))) {
				t.Fatalf("got %+v, issue %+v, want %v", got, issue, sample.want)
			}
		})
	}
	for _, sample := range []struct {
		text string
		want float64
	}{{"1.5", 2}, {"-1.5", -2}, {"1.2345", 1.235}} {
		expr := operation("round", fixed(sample.text)).(map[string]any)
		decimals := 0
		if sample.want == 1.235 {
			decimals = 3
		}
		expr["decimals"] = decimals
		result, issue := compileForTest(t, definition(expr), nil).Evaluate(nil)
		if issue != nil || result.Value != sample.want {
			t.Fatalf("round got %+v %+v", result, issue)
		}
	}
}

func makeDigits(n int) []byte {
	value := make([]byte, n)
	for i := range value {
		value[i] = '0'
	}
	return value
}

func TestProgramSharedResultsLazyInputsAndImmutableSnapshot(t *testing.T) {
	binding := map[string]any{"kind": "context", "contextKey": "amount"}
	root := map[string]any{
		"inputs": []any{map[string]any{"key": "input", "binding": binding}},
		"stages": []any{
			map[string]any{"key": "result", "name": "结果", "expression": operation("add", map[string]any{"op": "ref", "stageKey": "shared"}, map[string]any{"op": "ref", "stageKey": "shared"})},
			map[string]any{"key": "shared", "name": "共享", "expression": operation("add", map[string]any{"op": "read", "inputKey": "input"}, map[string]any{"op": "read", "inputKey": "input"})},
			map[string]any{"key": "unused", "name": "未用", "expression": operation("div", fixed("1"), fixed("0"))},
		}, "outputStageKey": "result",
	}
	p := compileForTest(t, root, []any{binding})
	root["stages"] = []any{}
	inputs := p.Inputs()
	inputs[0].Binding.ContextKey = "changed"
	for run := 1; run <= 3; run++ {
		reads := 0
		got, issue := p.Evaluate(func(slot uint16) (float64, *ContractIssue) { reads++; return float64(run), nil })
		if issue != nil || got.Value != float64(run*4) || reads != 1 || got.EvaluatedStages != 2 || got.ReadInputs != 1 || p.Inputs()[0].Binding.ContextKey != "amount" {
			t.Fatalf("shared result/input or snapshot violated: %+v %+v", got, issue)
		}
	}
	if _, issue := p.Evaluate(nil); issue == nil || issue.Code != "FORMULA_MISSING_INPUT" || issue.Path != "/stages/1/expression/args/0/inputKey" {
		t.Fatalf("missing issue %+v", issue)
	}
	if _, issue := p.Evaluate(func(uint16) (float64, *ContractIssue) { return math.Inf(1), nil }); issue == nil || issue.Code != "FORMULA_NON_FINITE" {
		t.Fatalf("nonfinite %+v", issue)
	}
}

func TestProgramTableActualShortIndexBoundary(t *testing.T) {
	p := compileForTest(t, definition(fixed("1")), nil)
	table := Table{}
	for i := 0; i < MaxPrograms; i++ {
		id, issue := table.Register(fmt.Sprintf("p%d", i), p, "/programs")
		if issue != nil || int(id) != i {
			t.Fatalf("id %d issue %+v at %d", id, issue, i)
		}
	}
	before := table.Stats()
	if _, issue := table.Register("overflow", p, "/overflow"); issue == nil || issue.Code != "FORMULA_LIMIT" || table.Stats() != before {
		t.Fatalf("overflow did not preserve table: %+v", issue)
	}
	for _, id := range []uint16{0, 65535} {
		result, issue := table.Evaluate(id, nil)
		if issue != nil || result.Value != 1 {
			t.Fatal("number wrapped or corrupted")
		}
	}
	if _, issue := table.Register("p0", p, ""); issue != nil || table.Stats() != before {
		t.Fatal("same program was not reused")
	}
	if _, issue := table.Register("p0", compileForTest(t, definition(fixed("2")), nil), ""); issue == nil || issue.Code != "FORMULA_DUPLICATE_KEY" || table.Stats() != before {
		t.Fatal("same key overwrote program")
	}
}

func TestProgramTableMemoryChargeIncludesLongPathsAndBindings(t *testing.T) {
	binding := map[string]any{"kind": "context", "contextKey": string(makeDigits(128))}
	inputs := make([]any, 64)
	for i := range inputs {
		inputs[i] = map[string]any{"key": fmt.Sprintf("in%d", i), "binding": binding}
	}
	root := definition(fixed("1")).(map[string]any)
	root["inputs"] = inputs
	p := compileForTest(t, root, []any{binding})
	if p.Stats().ChargedBytes < 64*128 {
		t.Fatal("binding text was not charged")
	}
	table := Table{}
	for i := 0; ; i++ {
		before := table.Stats()
		_, issue := table.Register(fmt.Sprintf("p%d", i), p, "/programs")
		if issue != nil {
			if issue.Code != "FORMULA_LIMIT" || before.Programs >= MaxPrograms || before.Inputs >= MaxTotalInputs || table.Stats() != before || MaxMemoryBytes-before.ChargedBytes >= p.Stats().ChargedBytes+len(fmt.Sprintf("p%d", i))+64 {
				t.Fatalf("wrong charge refusal %+v %+v", before, issue)
			}
			break
		}
	}
}

func TestProgramTableActualInstructionBoundary(t *testing.T) {
	p := compileForTest(t, definition(operation("add", operation("add", fixed("1"), fixed("2")), operation("add", fixed("3"), fixed("4")))), nil)
	if p.Stats().Instructions != 8 {
		t.Fatal(p.Stats())
	}
	table := Table{}
	for i := 0; i < MaxTotalInstructions/8; i++ {
		if _, issue := table.Register(fmt.Sprintf("p%d", i), p, "/programs"); issue != nil {
			t.Fatalf("could not reach real instruction limit: %+v at %d stats%+v", issue, i, table.Stats())
		}
	}
	before := table.Stats()
	if before.Instructions != MaxTotalInstructions {
		t.Fatal(before)
	}
	if _, issue := table.Register("over", compileForTest(t, definition(fixed("1")), nil), "/over"); issue == nil || issue.Code != "FORMULA_LIMIT" || table.Stats() != before {
		t.Fatalf("instruction limit not enforced %+v", issue)
	}
}
