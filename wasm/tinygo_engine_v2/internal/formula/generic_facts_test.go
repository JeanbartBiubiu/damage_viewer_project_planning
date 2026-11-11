package formula

import (
	"errors"
	"reflect"
	"testing"
)

func TestSpecialFactsReturnErrorsOnlyInSelectedBranch(t *testing.T) {
	for _, kind := range []GenericReadKind{ReadLinkedShieldPresent, ReadReceivedLinkedShieldAbsorbed, ReadEventProviderTargetStateBefore} {
		request := FactRequest{Kind: kind, Index: 9}
		read := GenericInstr{Op: GenericOpRead, ReadKind: kind, RefIndex: 9, ReferenceBound: true}
		if kind == ReadEventProviderTargetStateBefore {
			request.Index, request.Key, read.ReadKey = 0, "mark", "mark"
		}
		deferred := errors.New("frozen fact is missing its original identity")
		for _, selected := range []float64{0, 1} {
			var builder Builder
			id, err := builder.Register(GenericProgram{Key: "branch", Instr: []GenericInstr{
				{Op: GenericOpConst, Value: selected}, {Op: GenericOpJumpIfZero, JumpTarget: 4},
				read, {Op: GenericOpJump, JumpTarget: 5}, {Op: GenericOpConst, Value: 7},
			}})
			if err != nil {
				t.Fatal(err)
			}
			library := builder.Freeze()
			context := GenericEvalContext{HasProviderContext: true, HasEventContext: true, HasEventDamageSnapshot: true,
				Facts: PreparedFacts([]FactRequest{request}, [2]PreparedFact{{Err: deferred}}, nil)}
			before := context
			got, err := library.Evaluation.EvalContext(id, &context)
			if selected == 0 && (err != nil || got != 7) {
				t.Fatal("unselected special read returned its prepared error", kind, got, err)
			}
			if selected == 1 && !errors.Is(err, deferred) {
				t.Fatal("selected special read lost its own deferred error", kind, err)
			}
			if !reflect.DeepEqual(before, context) {
				t.Fatal("formula modified its input facts", kind)
			}
			if selected == 0 {
				continue
			}
			context.Facts = PreparedFacts([]FactRequest{request}, [2]PreparedFact{{Value: 0}}, nil)
			if got, err := library.Evaluation.EvalContext(id, &context); err != nil || got != 0 {
				t.Fatal("legitimate frozen zero was rejected", kind, got, err)
			}
			context.Facts = FactView{}
			if _, err := library.Evaluation.EvalContext(id, &context); err == nil {
				t.Fatal("missing fact became a numeric zero", kind)
			}
		}
	}
}

func TestRuntimeFormulaCapabilityCannotReceiveCallbacksOrMutableCollections(t *testing.T) {
	context := reflect.TypeOf(GenericEvalContext{})
	for index := 0; index < context.NumField(); index++ {
		field := context.Field(index)
		switch field.Type.Kind() {
		case reflect.Map, reflect.Slice, reflect.Func, reflect.Interface, reflect.Pointer:
			t.Fatal("runtime context grants a mutable collection or external capability", field.Name, field.Type)
		}
	}
	evaluator := reflect.TypeOf(Evaluator{})
	if evaluator.NumMethod() != 3 {
		t.Fatal("runtime formula object grants more than evaluation", evaluator.NumMethod())
	}
	for _, name := range []string{"Register", "BindAttributeLayout", "BindReadReference", "Freeze", "Instructions"} {
		if _, exists := evaluator.MethodByName(name); exists {
			t.Fatal("runtime formula object grants build or metadata access", name)
		}
	}
}
