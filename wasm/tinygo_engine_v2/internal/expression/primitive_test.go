package expression

import (
	"math"
	"reflect"
	"testing"
)

func TestPrimitiveEvaluationMatchesStageInterpreter(t *testing.T) {
	for _, opcode := range []string{"const", "read"} {
		for _, supplied := range []*ContractIssue{nil, {Code: "FORMULA_MISSING_INPUT"}, {Code: "FORMULA_NON_FINITE", Path: "/explicit"}} {
			for _, value := range []float64{0, math.Copysign(0, -1), 99, math.NaN(), math.Inf(1)} {
				var originalIssue ContractIssue
				if supplied != nil {
					originalIssue = *supplied
				}
				program := &Program{inputs: []Input{{Key: "actual"}}, stages: []resultProgram{{code: []instruction{{op: opcode, index: 0, value: value, path: "/stages/0/expression/inputKey"}}}}}
				calls := 0
				reader := func(index uint16) (float64, *ContractIssue) {
					calls++
					if index != 0 {
						t.Fatal("wrong input")
					}
					return value, supplied
				}
				state := evaluationState{program: program, reader: reader}
				wantValue, wantIssue := state.stage(program.output, 1)
				want := Evaluation{}
				if wantIssue == nil {
					state.stats.Value = wantValue
					want = state.stats
				}
				wantCalls := calls
				calls = 0
				got, gotIssue := program.Evaluate(reader)
				if !reflect.DeepEqual(gotIssue, wantIssue) || !reflect.DeepEqual(got, want) || math.Float64bits(got.Value) != math.Float64bits(want.Value) || calls != wantCalls {
					t.Fatalf("op=%s got=%+v/%+v want=%+v/%+v reads=%d/%d", opcode, got, gotIssue, want, wantIssue, calls, wantCalls)
				}
				if supplied != nil && *supplied != originalIssue {
					t.Fatal("modified caller issue")
				}
			}
		}
	}
}

func TestPrimitiveEvaluationKeepsInputAndProgramErrors(t *testing.T) {
	for _, missing := range []bool{false, true} {
		program := &Program{stages: []resultProgram{{code: []instruction{{op: "read", path: "/read"}}}}}
		want := "FORMULA_INVALID_PROGRAM"
		if missing {
			program.inputs = []Input{{Key: "value"}}
			want = "FORMULA_MISSING_INPUT"
		}
		if _, issue := program.Evaluate(nil); issue == nil || issue.Code != want || issue.Path != "/read" {
			t.Fatal(issue, want)
		}
	}
	for _, program := range []*Program{nil, {}, {stages: []resultProgram{{}}, output: 1}} {
		if _, issue := program.Evaluate(nil); issue == nil || issue.Code != "FORMULA_INVALID_PROGRAM" {
			t.Fatal(issue)
		}
	}
}
