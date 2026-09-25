package formula

import (
	"math"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func ifConst(value float64) model.GenericFormulaExpr {
	return model.GenericFormulaExpr{Op: "const", Value: &value}
}

func ifExpr(condition, yes, no model.GenericFormulaExpr) model.GenericFormulaExpr {
	return model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{condition, yes, no}}
}

func ifEval(t *testing.T, expr model.GenericFormulaExpr, ctx GenericEvalContext) (float64, error) {
	t.Helper()
	return mustCompileFormula(t, expr).Eval(0, ctx)
}

func TestGenericIfChoosesNonzeroBranchAndNestedBranches(t *testing.T) {
	for _, tc := range []struct {
		condition, want float64
	}{
		{-2, 11}, {0, 22}, {0.5, 11},
	} {
		got, err := ifEval(t, ifExpr(ifConst(tc.condition), ifConst(11), ifConst(22)), GenericEvalContext{})
		if err != nil || got != tc.want {
			t.Fatalf("condition=%v got=%v err=%v want=%v", tc.condition, got, err, tc.want)
		}
	}
	nested := model.GenericFormulaExpr{Op: "add", Args: []model.GenericFormulaExpr{
		ifExpr(ifConst(0), ifConst(999), ifExpr(ifConst(-1), ifConst(40), ifConst(998))),
		ifConst(2),
	}}
	got, err := ifEval(t, nested, GenericEvalContext{})
	if err != nil || got != 42 {
		t.Fatalf("nested and trailing op got=%v err=%v want=42", got, err)
	}
}

func TestGenericIfSkipsUnselectedDivisionAndStrictMissingRead(t *testing.T) {
	divideZero := model.GenericFormulaExpr{Op: "div", Args: []model.GenericFormulaExpr{ifConst(1), ifConst(0)}}
	missing := model.GenericFormulaExpr{Op: "read", Path: "target.attr.unavailable.current"}
	ctx := GenericEvalContext{StrictReads: true}
	for _, expr := range []model.GenericFormulaExpr{
		ifExpr(ifConst(0), divideZero, ifConst(7)),
		ifExpr(ifConst(-1), ifConst(7), divideZero),
		ifExpr(ifConst(0), missing, ifConst(7)),
		ifExpr(ifConst(1), ifConst(7), missing),
	} {
		got, err := ifEval(t, expr, ctx)
		if err != nil || got != 7 {
			t.Fatalf("unselected branch ran: got=%v err=%v", got, err)
		}
	}
	if _, err := ifEval(t, ifExpr(ifConst(1), divideZero, ifConst(7)), ctx); err == nil || !strings.Contains(err.Error(), "division by zero") {
		t.Fatalf("selected division error=%v", err)
	}
	if _, err := ifEval(t, ifExpr(ifConst(0), ifConst(7), missing), ctx); err == nil || !strings.Contains(err.Error(), "unavailable") {
		t.Fatalf("selected strict read error=%v", err)
	}
}

func TestGenericIfConstantFoldUsesOnlyChosenPath(t *testing.T) {
	missing := model.GenericFormulaExpr{Op: "read", Path: "target.attr.hp.current"}
	selected := model.GenericFormulaExpr{Op: "add", Args: []model.GenericFormulaExpr{
		ifExpr(ifConst(0), missing, ifConst(40)), ifConst(2),
	}}
	instr := mustCompileFormula(t, selected).Programs[0].Instr
	if got, folded := TryFoldConst(instr); !folded || got != 42 {
		t.Fatalf("folded=%v got=%v want 42", folded, got)
	}
	unselectedDivision := ifExpr(ifConst(1), ifConst(7), model.GenericFormulaExpr{
		Op: "div", Args: []model.GenericFormulaExpr{ifConst(1), ifConst(0)},
	})
	if got, folded := TryFoldConst(mustCompileFormula(t, unselectedDivision).Programs[0].Instr); !folded || got != 7 {
		t.Fatalf("unselected division fold=%v got=%v", folded, got)
	}
	if _, folded := TryFoldConst(mustCompileFormula(t, ifExpr(ifConst(1), missing, ifConst(7))).Programs[0].Instr); folded {
		t.Fatal("selected runtime read must not fold")
	}
	selectedDivision := ifExpr(ifConst(1), model.GenericFormulaExpr{
		Op: "div", Args: []model.GenericFormulaExpr{ifConst(1), ifConst(0)},
	}, ifConst(7))
	if got, folded := TryFoldConst(mustCompileFormula(t, selectedDivision).Programs[0].Instr); !folded || !math.IsNaN(got) {
		t.Fatalf("selected division fold=%v got=%v want invalid folded value", folded, got)
	}
}

func TestGenericIfCompilesNamedExpansionAndValidatesUnselectedBranches(t *testing.T) {
	defs := []model.NamedFormula{
		{Key: "branch", Expression: ifExpr(ifConst(0), ifConst(99), ifConst(40))},
		{Key: "result", Expression: model.GenericFormulaExpr{Op: "add", Args: []model.GenericFormulaExpr{
			{Op: "ref", Ref: "branch"}, ifConst(2),
		}}},
	}
	var errors []model.EngineError
	add := func(code model.GenericErrCode, path, message, ref string) {
		errors = append(errors, model.EngineError{Code: code, Path: path, Message: message, Ref: ref})
	}
	reg := CompileNamedFormulas(defs, add)
	if len(errors) != 0 {
		t.Fatalf("named compile errors=%+v", errors)
	}
	got, err := reg.Eval(reg.Index["result"], GenericEvalContext{})
	if err != nil || got != 42 {
		t.Fatalf("named if got=%v err=%v", got, err)
	}

	badCases := []struct {
		name  string
		expr  model.GenericFormulaExpr
		named map[string]model.GenericFormulaExpr
	}{
		{"unknown_path", ifExpr(ifConst(0), model.GenericFormulaExpr{Op: "read", Path: "history.invalid"}, ifConst(1)), nil},
		{"unknown_ref", ifExpr(ifConst(0), model.GenericFormulaExpr{Op: "ref", Ref: "missing"}, ifConst(1)), nil},
		{"unsupported_op", ifExpr(ifConst(0), model.GenericFormulaExpr{Op: "mystery"}, ifConst(1)), nil},
		{"ref_cycle", ifExpr(ifConst(0), model.GenericFormulaExpr{Op: "ref", Ref: "cycle"}, ifConst(1)),
			map[string]model.GenericFormulaExpr{"cycle": {Op: "ref", Ref: "cycle"}}},
	}
	for _, tc := range badCases {
		t.Run(tc.name, func(t *testing.T) {
			errors = nil
			CompileGenericFormula(tc.expr, "test", tc.named, map[string]bool{}, add)
			if len(errors) == 0 || !strings.Contains(errors[0].Path, "args[1]") {
				t.Fatalf("unselected branch must be validated: %+v", errors)
			}
		})
	}
	for _, args := range [][]model.GenericFormulaExpr{
		{ifConst(1), ifConst(2)},
		{ifConst(1), ifConst(2), ifConst(3), ifConst(4)},
	} {
		errors = nil
		CompileGenericFormula(model.GenericFormulaExpr{Op: "if", Args: args}, "test", nil, map[string]bool{}, add)
		if len(errors) == 0 || errors[0].Path != "test.args" {
			t.Fatalf("if arity errors=%+v", errors)
		}
	}
	deep := ifConst(1)
	for i := 0; i < maxGenericFormulaDepth; i++ {
		deep = ifExpr(ifConst(0), deep, ifConst(1))
	}
	errors = nil
	CompileGenericFormula(deep, "test", nil, map[string]bool{}, add)
	if len(errors) == 0 || !strings.Contains(errors[0].Message, "maximum depth") {
		t.Fatalf("unselected deep branch errors=%+v", errors)
	}
}

func TestGenericIfJumpTargetsAndBranchStacks(t *testing.T) {
	instr := mustCompileFormula(t, ifExpr(ifConst(0), ifConst(1), ifConst(2))).Programs[0].Instr
	if !validGenericProgramStack(instr) {
		t.Fatalf("compiled if stack invalid: %+v", instr)
	}
	for pc, in := range instr {
		if in.Op == GenericOpJumpIfZero || in.Op == GenericOpJump {
			if !validForwardJump(pc, in.JumpTarget, len(instr)) {
				t.Fatalf("jump[%d]=%d invalid: %+v", pc, in.JumpTarget, instr)
			}
		}
	}
	broken := append([]GenericInstr(nil), instr...)
	broken[1].JumpTarget = 1
	if validGenericProgramStack(broken) {
		t.Fatal("backward jump accepted")
	}
	reg := GenericRegistry{Programs: []GenericProgram{{Instr: broken}}}
	if _, err := reg.Eval(0, GenericEvalContext{}); err == nil || !strings.Contains(err.Error(), "jump target") {
		t.Fatalf("bad jump eval error=%v", err)
	}
}
