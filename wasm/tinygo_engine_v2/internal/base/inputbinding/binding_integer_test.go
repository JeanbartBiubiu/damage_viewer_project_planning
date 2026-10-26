package inputbinding

import (
	"math"
	"testing"
	"unsafe"

	"tinygo_engine_v2/internal/base/expression"
)

func TestSafeIntegerReadValidationRemainsLazyAndDoesNotGrowScalar(t *testing.T) {
	if unsafe.Sizeof(Scalar{}) != unsafe.Sizeof(struct {
		Value   float64
		Present bool
	}{}) {
		t.Fatal("safe integer flag changed numeric storage size", unsafe.Sizeof(Scalar{}))
	}
	for _, lazy := range []bool{false, true} {
		binding := expression.Binding{Kind: "parameter", SkillKey: "spell", ParameterKey: "cycles"}
		program := compileBinding(t, binding, lazy)
		plan, issue := Bind(program, []expression.Binding{binding})
		if issue != nil {
			t.Fatal(issue)
		}
		for _, number := range []float64{0, 1, -1, 9007199254740991, 0.25, 9007199254740992} {
			value := []Value{{Number: Scalar{Value: number, Present: true, SafeInteger: true}}}
			got, issue := plan.Evaluate(program, value)
			valid := lazy || math.Trunc(number) == number && math.Abs(number) <= 9007199254740991
			if valid != (issue == nil) || !lazy && valid && got.Value != number {
				t.Fatal(lazy, number, got, issue)
			}
		}
	}
}
