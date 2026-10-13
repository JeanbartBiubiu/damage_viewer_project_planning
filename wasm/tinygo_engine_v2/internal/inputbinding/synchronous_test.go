package inputbinding

import (
	"math"
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/expression"
)

func TestSynchronousEvaluationMatchesFrozenReads(t *testing.T) {
	for _, kind := range []string{"BASE", "TOTAL", "CURRENT", "MAX", "BONUS", "MISSING", "CURRENT_RATIO", "MISSING_RATIO"} {
		for _, lazy := range []bool{false, true} {
			binding := expression.Binding{Kind: "attribute", Object: "target", AttributeKey: "hp", ValueKind: kind, View: "current_frame"}
			program := compileBinding(t, binding, lazy)
			plan, issue := Bind(program, []expression.Binding{binding})
			if issue != nil {
				t.Fatal(issue)
			}
			for _, value := range []Value{{}, {Base: Scalar{math.Copysign(0, -1), true}, Total: Scalar{120, true}, Current: Scalar{0, true}, Max: Scalar{0, true}}, {Base: Scalar{20, true}, Total: Scalar{120, true}, Current: Scalar{25, true}, Max: Scalar{100, true}}, {Total: Scalar{math.Inf(1), true}}} {
				values := []Value{value}
				reader, issue := plan.Reader(values)
				if issue != nil {
					t.Fatal(issue)
				}
				want, wantIssue := program.Evaluate(reader)
				got, gotIssue := plan.Evaluate(program, values)
				if !reflect.DeepEqual(wantIssue, gotIssue) || !reflect.DeepEqual(want, got) || math.Float64bits(want.Value) != math.Float64bits(got.Value) || !reflect.DeepEqual(values[0], value) {
					t.Fatalf("kind=%s lazy=%v got=%+v/%+v want=%+v/%+v", kind, lazy, got, gotIssue, want, wantIssue)
				}
			}
		}
	}
}

func TestSynchronousEvaluationDoesNotRetainValuesOrAllocate(t *testing.T) {
	binding := expression.Binding{Kind: "parameter", SkillKey: "hit", ParameterKey: "amount"}
	program := compileBinding(t, binding, false)
	plan, issue := Bind(program, []expression.Binding{binding})
	if issue != nil {
		t.Fatal(issue)
	}
	values := []Value{{Number: Scalar{0, true}}}
	if allocations := testing.AllocsPerRun(100, func() {
		result, issue := plan.Evaluate(program, values)
		if issue != nil || result.Value != values[0].Number.Value {
			t.Fatal(result, issue)
		}
	}); allocations != 0 {
		t.Fatalf("synchronous evaluation allocated %v", allocations)
	}
	values[0].Number.Value = 99
	result, issue := plan.Evaluate(program, values)
	if issue != nil || result.Value != 99 {
		t.Fatal("retained previous input", result, issue)
	}
	if _, issue := plan.Evaluate(program, append(values, Value{})); issue == nil || issue.Path != "/values" {
		t.Fatal("invalid values length accepted", issue)
	}
	if _, issue := (*Plan)(nil).Evaluate(program, nil); issue == nil || issue.Code != "FORMULA_INVALID_PROGRAM" {
		t.Fatal("nil plan accepted", issue)
	}
}
