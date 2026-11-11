package compile

import (
	"strconv"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func TestRegisterFormulaRejectsFirstProgramWithoutUsableID(t *testing.T) {
	collector := &genericCollector{}
	ctx := &genericCompileContext{collector: collector, session: &plan.CompiledSession{}}
	instructions := make([]formula.GenericInstr, formula.MaxGenericProgramInstructions+1)
	if id, has := ctx.registerFormula("rejected", instructions); has || id != 0 || ctx.formulas.Count() != 0 {
		t.Fatal("failed first program was consumed or registered")
	}
	if len(collector.errors) != 1 || collector.errors[0].Path != "rejected" {
		t.Fatal(collector.errors)
	}
	constant := 5.0
	expr := model.GenericFormulaExpr{Op: "const", Value: &constant}
	if id, has := compileProcessFormula(&expr, "accepted", true, true, ctx); !has || id != 0 {
		t.Fatal("valid program after refusal failed")
	}
}

func TestProcessRegistrationMemoryRefusalDoesNotFoldProgramZero(t *testing.T) {
	collector := &genericCollector{}
	ctx := &genericCompileContext{collector: collector, session: &plan.CompiledSession{}}
	expr := model.GenericFormulaExpr{Op: "read", Path: "source.attr." + strings.Repeat("x", formula.MaxGenericFormulaMemoryBytes)}
	if id, has := compileProcessWindowFormula(&expr, "window", true, ctx); has || id != 0 || ctx.formulas.Count() != 0 {
		t.Fatal("memory refusal became usable process program")
	}
	if len(collector.errors) == 0 {
		t.Fatal("expected budget diagnostic")
	}
}

func TestProcessRegistrationFullTableRefusalDoesNotConsumeProgramZero(t *testing.T) {
	collector := &genericCollector{}
	ctx := &genericCompileContext{collector: collector, session: &plan.CompiledSession{}}
	for i := 0; i < formula.MaxGenericPrograms; i++ {
		if _, err := ctx.formulas.Register(formula.GenericProgram{Key: strconv.Itoa(i), Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 1}}}); err != nil {
			t.Fatal(err)
		}
	}
	constant := 2.0
	expr := model.GenericFormulaExpr{Op: "const", Value: &constant}
	if id, has := compileProcessWindowFormula(&expr, "refused", true, ctx); has || id != 0 {
		t.Fatal("full table refusal became usable program")
	}
	if ctx.formulas.Count() != formula.MaxGenericPrograms || ctx.formulas.Instructions(formula.GenericProgramID(0))[0].Value != 1 {
		t.Fatal("full table refusal changed existing program")
	}
}

func TestCompileRefusesExcessiveNamedProgramsWithoutSession(t *testing.T) {
	req := minimalValidCompileRequest()
	req.Formulas = make([]model.NamedFormula, formula.MaxGenericPrograms+1)
	for i := range req.Formulas {
		req.Formulas[i] = formuladefinition.Constant("p"+strconv.Itoa(i), "budget", 1)
	}
	result := CompileGeneric(req)
	if result.OK || result.Result.OK || result.Session.Formulas.Metadata.Count() != 0 || len(result.Result.Errors) == 0 {
		t.Fatal("oversized compile created runnable session")
	}
}
