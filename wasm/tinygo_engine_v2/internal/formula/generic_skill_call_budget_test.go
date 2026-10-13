package formula

import (
	"reflect"
	"strconv"
	"testing"
)

func TestPhase3BCallDepthAndCombinedBudgetPreflightAtomic(t *testing.T) {
	var reg GenericRegistry
	id, err := reg.Register(registryConstProgram("root", 1))
	if err != nil {
		t.Fatal(err)
	}
	for depth := 2; depth <= 32; depth++ {
		id, err = reg.Register(GenericProgram{Key: "depth" + strconv.Itoa(depth), Instr: []GenericInstr{{Op: GenericOpRef, RefIndex: uint16(id)}}})
		if err != nil {
			t.Fatal(depth, err)
		}
	}
	before := *reg.CloneForRun()
	if _, err = reg.Register(GenericProgram{Key: "too_deep", Instr: []GenericInstr{{Op: GenericOpRef, RefIndex: uint16(id)}}}); err == nil || !reflect.DeepEqual(before, reg) {
		t.Fatal("depth overflow changed table", err)
	}
	if value, err := reg.Eval(id, GenericEvalContext{}); err != nil || value != 1 {
		t.Fatal(value, err)
	}
	var expensive GenericRegistry
	leaf := GenericProgram{Key: "leaf", Instr: []GenericInstr{{Op: GenericOpConst, Value: 1}}}
	for len(leaf.Instr) < 512 {
		leaf.Instr = append(leaf.Instr, GenericInstr{Op: GenericOpFloor})
	}
	leafID, err := expensive.Register(leaf)
	if err != nil {
		t.Fatal(err)
	}
	code := []GenericInstr{{Op: GenericOpRef, RefIndex: uint16(leafID)}}
	for i := 1; i < 256; i++ {
		code = append(code, GenericInstr{Op: GenericOpRef, RefIndex: uint16(leafID)}, GenericInstr{Op: GenericOpAdd})
	}
	middle, err := expensive.Register(GenericProgram{Key: "middle", Instr: code})
	if err != nil {
		t.Fatal(err)
	}
	before = *expensive.CloneForRun()
	if _, err = expensive.Register(GenericProgram{Key: "too_expensive", Instr: []GenericInstr{{Op: GenericOpRef, RefIndex: uint16(middle)}, {Op: GenericOpRef, RefIndex: uint16(middle)}, {Op: GenericOpAdd}}}); err == nil || !reflect.DeepEqual(before, expensive) {
		t.Fatal("calls counted as cheap single instructions", err)
	}
	if value, err := expensive.Eval(middle, GenericEvalContext{}); err != nil || value != 256 {
		t.Fatal(value, err)
	}
}

func TestPhase3BCallRuntimeBudgetAlsoRejectsMutatedInvalidProgram(t *testing.T) {
	reg := GenericRegistry{Programs: []GenericProgram{{Key: "cycle", Instr: []GenericInstr{{Op: GenericOpRef, RefIndex: 0}}}}}
	_, err := reg.Eval(0, GenericEvalContext{})
	authored, ok := err.(*AuthoredEvaluationError)
	if !ok || authored.Issue.Code != "FORMULA_LIMIT" {
		t.Fatal(err)
	}
}
