package execution

import (
	"reflect"
	"strconv"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

func TestRunDriverProgramsDoNotMutateReusablePlan(t *testing.T) {
	request, run := loadGenericRunFixture(t, "formula_phase4_explicit_basic_damage.json")
	compiled := compile.CompileGeneric(request)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	one := 1.0
	condition := model.GenericFormulaExpr{Op: "const", Value: &one}
	run.DriverPlan.Entries[0].Condition = &condition
	interval := 10.0
	run.DriverPlan.Entries[0].Repeat = &model.DriverRepeat{IntervalFormula: &model.GenericFormulaExpr{Op: "const", Value: &interval}}
	run.StopPolicy.StopWhenNoEvents = model.BoolPtr(false)
	before := compiled.Session.Formulas
	for i := 0; i < 3; i++ {
		state, issue := newGenericRunState(compiled.Session, run)
		if issue != nil {
			t.Fatal(issue)
		}
		if state.formulas.Metadata.Count() != before.Metadata.Count()+2 || state.compiled.Formulas.Metadata.Count() != before.Metadata.Count() {
			t.Fatal("temporary formulas were not run-owned")
		}
		if !reflect.DeepEqual(compiled.Session.Formulas, before) {
			t.Fatal("driver program modified reusable plan")
		}
		condition, present := state.actions.DriverCondition(0)
		if !present {
			t.Fatal("missing compiled driver condition")
		}
		value, err := state.formulas.Evaluation.Eval(condition, formula.GenericEvalContext{})
		if err != nil || value != 1 {
			t.Fatal("run-local condition did not execute")
		}
		if _, issue := runForTest(compiled.Session, run); issue != nil {
			t.Fatal(issue)
		}
	}
	zero := 0.0
	run.DriverPlan.Entries[0].Condition = &model.GenericFormulaExpr{Op: "div", Args: []model.GenericFormulaExpr{{Op: "const", Value: &one}, {Op: "const", Value: &zero}}}
	if _, issue := runForTest(compiled.Session, run); issue == nil {
		t.Fatal("invalid runtime arithmetic succeeded")
	}
	if !reflect.DeepEqual(compiled.Session.Formulas, before) {
		t.Fatal("failed run modified plan")
	}
	run.DriverPlan.Entries[0].Condition = &condition
	if _, issue := runForTest(compiled.Session, run); issue != nil {
		t.Fatal("failed run contaminated following run", issue)
	}
}

func TestRunDriverProgramBudgetRefusalPreservesPlan(t *testing.T) {
	request, run := loadGenericRunFixture(t, "formula_phase4_explicit_basic_damage.json")
	compiled := compile.CompileGeneric(request)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	builder := formula.NewBuilder(compiled.Session.Formulas)
	for i := compiled.Session.Formulas.Metadata.Count(); i < formula.MaxGenericPrograms; i++ {
		if _, err := builder.Register(formula.GenericProgram{Key: "padding" + strconv.Itoa(i), Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 1}}}); err != nil {
			t.Fatal(err)
		}
	}
	compiled.Session.Formulas = builder.Freeze()
	value := 1.0
	run.DriverPlan.Entries[0].Condition = &model.GenericFormulaExpr{Op: "const", Value: &value}
	before := compiled.Session.Formulas
	if _, issue := newGenericRunState(compiled.Session, run); issue == nil || issue.Code != model.GenericErrFormulaTypeError {
		t.Fatal("full table driver did not reject", issue)
	}
	if !reflect.DeepEqual(compiled.Session.Formulas, before) {
		t.Fatal("budget rejection modified plan")
	}
	run.DriverPlan.Entries[0].Condition = nil
	if _, issue := runForTest(compiled.Session, run); issue != nil {
		t.Fatal("budget rejection contaminated subsequent run", issue)
	}
}
