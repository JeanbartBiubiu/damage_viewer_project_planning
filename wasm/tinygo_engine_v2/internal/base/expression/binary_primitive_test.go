package expression

import (
	"math"
	"reflect"
	"testing"
)

func TestBinaryPrimitiveMatchesInterpreter(t *testing.T) {
	values := []float64{0, math.Copysign(0, -1), 1.25, -3, math.MaxFloat64, math.SmallestNonzeroFloat64, math.NaN(), math.Inf(1)}
	for _, op := range []string{"add", "sub", "mul", "div", "min", "max", "eq", "ne", "lt", "lte", "gt", "gte"} {
		for _, shape := range []string{"const/const", "read/const", "const/read", "read/read", "same-read"} {
			for _, left := range values {
				for _, right := range values {
					code := []instruction{{op: "const", value: left, path: "/left"}, {op: "const", value: right, index: 1, path: "/right"}, {op: op, path: "/result"}}
					switch shape {
					case "read/const":
						code[0].op = "read"
					case "const/read":
						code[1].op = "read"
					case "read/read", "same-read":
						code[0].op, code[1].op = "read", "read"
						if shape == "same-read" {
							code[1].index = 0
						}
					}
					program := &Program{inputs: []Input{{Key: "a"}, {Key: "b"}}, stages: []resultProgram{{code: nil}, {code: code}}, output: 1}
					compareBinaryPrimitive(t, program, []float64{left, right}, nil, false)
				}
			}
		}
	}
}

func TestBinaryPrimitivePreservesErrorsAndReadOrder(t *testing.T) {
	for _, failedSlot := range []uint16{0, 1} {
		for _, path := range []string{"", "/original"} {
			issue := &ContractIssue{Code: "FORMULA_MISSING_INPUT", Path: path}
			original := *issue
			program := &Program{inputs: []Input{{Key: "a"}, {Key: "b"}}, stages: []resultProgram{{code: []instruction{{op: "read", path: "/left"}, {op: "read", index: 1, path: "/right"}, {op: "add", path: "/result"}}}}}
			compareBinaryPrimitive(t, program, []float64{2, 3}, map[uint16]*ContractIssue{failedSlot: issue}, false)
			if *issue != original {
				t.Fatal("changed caller issue")
			}
		}
	}
	for _, inputs := range []int{0, 1, 2} {
		program := &Program{inputs: make([]Input, inputs), stages: []resultProgram{{code: []instruction{{op: "read", path: "/left"}, {op: "read", index: 1, path: "/right"}, {op: "div", path: "/result"}}}}}
		compareBinaryPrimitive(t, program, []float64{2, 0}, nil, false)
		compareBinaryPrimitive(t, program, []float64{2, 0}, nil, true)
	}
}

func compareBinaryPrimitive(t *testing.T, program *Program, supplied []float64, failures map[uint16]*ContractIssue, missingReader bool) {
	t.Helper()
	var calls []uint16
	reader := ReadInput(func(slot uint16) (float64, *ContractIssue) {
		calls = append(calls, slot)
		return supplied[slot], failures[slot]
	})
	if missingReader {
		reader = nil
	}
	state := evaluationState{program: program, reader: reader}
	value, wantIssue := state.stage(program.output, 1)
	want := Evaluation{}
	if wantIssue == nil {
		state.stats.Value = value
		want = state.stats
	}
	wantCalls := append([]uint16(nil), calls...)
	calls = nil
	got, gotIssue := program.Evaluate(reader)
	if !reflect.DeepEqual(gotIssue, wantIssue) || !reflect.DeepEqual(got, want) || math.Float64bits(got.Value) != math.Float64bits(want.Value) || !reflect.DeepEqual(calls, wantCalls) {
		t.Fatalf("code=%+v got=%+v/%+v want=%+v/%+v reads=%v/%v", program.stages[program.output].code, got, gotIssue, want, wantIssue, calls, wantCalls)
	}
}
