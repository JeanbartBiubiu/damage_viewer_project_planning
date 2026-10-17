package compile

import (
	"testing"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func elapsedAuthoredDefinition() model.NamedFormula {
	return model.NamedFormula{Key: "authored_elapsed", Scope: "skill", SkillKey: "configured_skill", Parameters: []model.FormulaParameter{},
		Expression: formuladefinition.Definition([]any{map[string]any{"key": "elapsed", "binding": map[string]any{"kind": "context", "contextKey": "effect_elapsed_ms"}}},
			[]any{formuladefinition.Stage("output", map[string]any{"op": "read", "inputKey": "elapsed"})}, "output")}
}

func TestAuthoredElapsedDeclarationAndActualFiniteUse(t *testing.T) {
	r := minimalValidCompileRequest()
	r.Formulas = []model.NamedFormula{elapsedAuthoredDefinition()}
	result := CompileGeneric(r)
	if !result.OK {
		t.Fatal("declaration without instance is not an execution", result.Result.Errors)
	}
	if _, err := result.Session.Formulas.Eval(0, formula.GenericEvalContext{}); err == nil {
		t.Fatal("missing actual elapsed context was zero-filled")
	}
	r = elapsedCompileInput()
	r.Formulas = []model.NamedFormula{elapsedAuthoredDefinition()}
	r.SharedProviders[1].SkillKey = "configured_skill"
	r.SharedProviders[1].Modifiers[0].Value = model.GenericFormulaExpr{Op: "ref", Ref: "authored_elapsed"}
	result = CompileGeneric(r)
	if !result.OK {
		t.Fatal(result.Result.Errors)
	}
	program := result.Session.Providers[1].Modifiers[0].ValueProgram
	value, err := result.Session.Formulas.Eval(program, formula.GenericEvalContext{HasProviderElapsed: true, ProviderElapsedMs: 750})
	if err != nil || value != 750 {
		t.Fatal(value, err)
	}
	if _, cacheable := result.Session.Formulas.AttributeCacheDependencies(program); cacheable {
		t.Fatal("authored elapsed formula reused timeless cache")
	}
	r.SharedProviders[1].Abilities = []model.AbilityDefinition{{AbilityKey: "illegal", Kind: "active", SkillKey: "configured_skill", Operations: []model.OperationDefinition{{Operation: "heal", Target: "self", Amount: &model.GenericFormulaExpr{Op: "ref", Ref: "authored_elapsed"}}}}}
	if invalid := CompileGeneric(r); invalid.OK {
		t.Fatal("shared declaration escaped into ordinary operation")
	}
}
