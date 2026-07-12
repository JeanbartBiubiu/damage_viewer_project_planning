package formula

import (
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestCompileGenericFormulaP0Paths(t *testing.T) {
	var errors []model.EngineError
	addError := func(code model.GenericErrCode, path, message, ref string) {
		errors = append(errors, model.EngineError{Code: code, Path: path, Message: message, Ref: ref})
	}
	expr := model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "source.attr.attack_damage.resolved"},
			{Op: "read", Path: "ability.param.baseDamage"},
		},
	}
	instr := CompileGenericFormula(expr, "amount", map[string]model.GenericFormulaExpr{}, map[string]bool{}, addError)
	if len(errors) != 0 {
		t.Fatalf("errors=%+v", errors)
	}
	if len(instr) != 3 {
		t.Fatalf("instr len %d", len(instr))
	}
}

func TestCompileGenericFormulaRejectsHistoryPath(t *testing.T) {
	var errors []model.EngineError
	addError := func(code model.GenericErrCode, path, message, ref string) {
		errors = append(errors, model.EngineError{Code: code})
	}
	expr := model.GenericFormulaExpr{Op: "read", Path: "history.damage_dealt.sum.3000ms"}
	CompileGenericFormula(expr, "amount", map[string]model.GenericFormulaExpr{}, map[string]bool{}, addError)
	if len(errors) == 0 {
		t.Fatal("expected formula_type_error")
	}
	if errors[0].Code != model.GenericErrFormulaTypeError {
		t.Fatalf("code=%q", errors[0].Code)
	}
}

func TestCompileGenericFormulaRejectsAbilityStatePath(t *testing.T) {
	var errors []model.EngineError
	addError := func(code model.GenericErrCode, path, message, ref string) {
		errors = append(errors, model.EngineError{Code: code})
	}
	expr := model.GenericFormulaExpr{Op: "read", Path: "ability.state.charges"}
	CompileGenericFormula(expr, "amount", map[string]model.GenericFormulaExpr{}, map[string]bool{}, addError)
	if len(errors) == 0 || errors[0].Code != model.GenericErrFormulaTypeError {
		t.Fatalf("errors=%+v", errors)
	}
}

func TestCompileGenericFormulaSupportsClampRound(t *testing.T) {
	var errors []model.EngineError
	addError := func(code model.GenericErrCode, path, message, ref string) {
		errors = append(errors, model.EngineError{Code: code})
	}
	v := 10.0
	min := model.GenericFormulaExpr{Op: "const", Value: &v}
	max := model.GenericFormulaExpr{Op: "const", Value: &v}
	expr := model.GenericFormulaExpr{
		Op:   "clamp",
		Expr: &model.GenericFormulaExpr{Op: "read", Path: "target.attr.hp.current"},
		Min:  &min,
		Max:  &max,
	}
	instr := CompileGenericFormula(expr, "amount", map[string]model.GenericFormulaExpr{}, map[string]bool{}, addError)
	if len(errors) != 0 {
		t.Fatalf("errors=%+v", errors)
	}
	if len(instr) != 4 || instr[3].Op != GenericOpClamp {
		t.Fatalf("instr=%+v", instr)
	}
}

func TestCompileGenericFormulaSupportsCompareOps(t *testing.T) {
	var errors []model.EngineError
	addError := func(code model.GenericErrCode, path, message, ref string) {
		errors = append(errors, model.EngineError{Code: code, Path: path, Message: message, Ref: ref})
	}
	one := 1.0
	two := 2.0
	expr := model.GenericFormulaExpr{
		Op: "gte",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &two},
			{Op: "const", Value: &one},
		},
	}
	instr := CompileGenericFormula(expr, "cond", map[string]model.GenericFormulaExpr{}, map[string]bool{}, addError)
	if len(errors) != 0 {
		t.Fatalf("errors=%+v", errors)
	}
	if len(instr) != 3 || instr[2].Op != GenericOpGte {
		t.Fatalf("instr=%+v", instr)
	}
}

func TestCompileGenericFormulaRejectsCompareBadArity(t *testing.T) {
	var errors []model.EngineError
	addError := func(code model.GenericErrCode, path, message, ref string) {
		errors = append(errors, model.EngineError{Code: code, Message: message})
	}
	one := 1.0
	expr := model.GenericFormulaExpr{
		Op:   "eq",
		Args: []model.GenericFormulaExpr{{Op: "const", Value: &one}},
	}
	CompileGenericFormula(expr, "cond", map[string]model.GenericFormulaExpr{}, map[string]bool{}, addError)
	if len(errors) == 0 || errors[0].Code != model.GenericErrFormulaTypeError {
		t.Fatalf("errors=%+v", errors)
	}
}

func TestCompileGenericFormulaAllowsProviderStatePaths(t *testing.T) {
	var errors []model.EngineError
	addError := func(code model.GenericErrCode, path, message, ref string) {
		errors = append(errors, model.EngineError{Code: code})
	}
	expr := model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "provider.state.counter"},
			{Op: "read", Path: "provider.target_state.hits"},
		},
	}
	instr := CompileGenericFormula(expr, "amount", map[string]model.GenericFormulaExpr{}, map[string]bool{}, addError)
	if len(errors) != 0 {
		t.Fatalf("errors=%+v", errors)
	}
	if len(instr) != 3 {
		t.Fatalf("instr len %d", len(instr))
	}
	if instr[0].ReadKind != ReadProviderState || instr[1].ReadKind != ReadProviderTargetState {
		t.Fatalf("read kinds=%v %v", instr[0].ReadKind, instr[1].ReadKind)
	}
}
