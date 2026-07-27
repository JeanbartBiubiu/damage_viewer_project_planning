package formula

import (
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestCompileC1DamageTraitAndTypeReads(t *testing.T) {
	var errors []model.EngineError
	addError := func(code model.GenericErrCode, path, message, ref string) {
		errors = append(errors, model.EngineError{Code: code, Path: path, Message: message, Ref: ref})
	}
	cases := []struct {
		path string
		kind GenericReadKind
		key  string
	}{
		{"damage.trait.on_hit", ReadDamageTrait, "on_hit"},
		{"damage.type.physical", ReadDamageType, "physical"},
		{"damage.type.magic", ReadDamageType, "magic"},
		{"damage.type.true", ReadDamageType, "true"},
		{"event.damage.baseRawAmount", ReadEventDamage, "baseRawAmount"},
		{"event.damage.naturalBranchRawAmount", ReadEventDamage, "naturalBranchRawAmount"},
	}
	for _, tc := range cases {
		errors = nil
		instr := CompileGenericFormula(
			model.GenericFormulaExpr{Op: "read", Path: tc.path},
			"cond", map[string]model.GenericFormulaExpr{}, map[string]bool{}, addError,
		)
		if len(errors) != 0 {
			t.Fatalf("%s errors=%+v", tc.path, errors)
		}
		if len(instr) != 1 || instr[0].ReadKind != tc.kind || instr[0].ReadKey != tc.key {
			t.Fatalf("%s instr=%+v", tc.path, instr)
		}
	}
}

func TestCompileC1RejectsUnknownDamageTypeAndEventDamagePaths(t *testing.T) {
	var errors []model.EngineError
	addError := func(code model.GenericErrCode, path, message, ref string) {
		errors = append(errors, model.EngineError{Code: code})
	}
	for _, path := range []string{"damage.type.chaos", "event.damage.unknownField", "damage.trait."} {
		errors = nil
		CompileGenericFormula(
			model.GenericFormulaExpr{Op: "read", Path: path},
			"cond", map[string]model.GenericFormulaExpr{}, map[string]bool{}, addError,
		)
		if len(errors) == 0 {
			t.Fatalf("expected reject for %s", path)
		}
	}
}

func TestEvalC1DamageTraitTypeAndEventDamage(t *testing.T) {
	reg := mustCompileFormula(t, model.GenericFormulaExpr{Op: "read", Path: "damage.trait.on_hit"})
	got, err := reg.Eval(0, GenericEvalContext{
		HasDamageContext: true,
		DamageTraits:     []string{"damage_trait/on_hit"},
	})
	if err != nil || got != 1 {
		t.Fatalf("trait match got=%v err=%v", got, err)
	}
	got, err = reg.Eval(0, GenericEvalContext{
		HasDamageContext: true,
		DamageTraits:     []string{"damage_trait/proc"},
	})
	if err != nil || got != 0 {
		t.Fatalf("trait miss got=%v err=%v", got, err)
	}
	if _, err := reg.Eval(0, GenericEvalContext{}); err == nil {
		t.Fatal("expected fail closed without damage context")
	}

	reg = mustCompileFormula(t, model.GenericFormulaExpr{Op: "read", Path: "damage.type.magic"})
	got, err = reg.Eval(0, GenericEvalContext{HasDamageContext: true, DamageTypeKey: "damage/magical"})
	if err != nil || got != 1 {
		t.Fatalf("magic alias got=%v err=%v", got, err)
	}

	reg = mustCompileFormula(t, model.GenericFormulaExpr{Op: "read", Path: "event.damage.mitigatedAmount"})
	got, err = reg.Eval(0, GenericEvalContext{
		HasEventContext:        true,
		HasEventDamageSnapshot: true,
		EventDamage:            EventDamageSnapshot{MitigatedAmount: 42},
	})
	if err != nil || got != 42 {
		t.Fatalf("event.damage got=%v err=%v", got, err)
	}
	if _, err := reg.Eval(0, GenericEvalContext{HasEventContext: true}); err == nil {
		t.Fatal("expected fail closed without damage snapshot")
	}
}
