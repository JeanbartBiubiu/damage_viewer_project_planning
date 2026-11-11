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
		{"event.damage.actualHpLoss", ReadEventDamage, "actualHpLoss"},
		{"event.damage.killed", ReadEventDamage, "killed"},
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

func TestEvalKilledRequiresRealSettlementAndPreservesZero(t *testing.T) {
	reg := mustCompileFormula(t, model.GenericFormulaExpr{Op: "read", Path: "event.damage.killed"})
	for _, killed := range []float64{0, 1} {
		value, err := reg.evaluate(0, GenericEvalContext{HasEventContext: true, HasEventDamageSnapshot: true, EventDamage: EventDamageSnapshot{HasKilled: true, Killed: killed}})
		if err != nil || value != killed {
			t.Fatal("settled kill flag changed", killed, value, err)
		}
	}
	for _, context := range []GenericEvalContext{
		{}, {HasEventContext: true},
		{HasEventContext: true, HasEventDamageSnapshot: true},
		{HasEventContext: true, HasEventDamageSnapshot: true, EventDamage: EventDamageSnapshot{Killed: 1}},
		{HasEventContext: true, HasEventDamageSnapshot: true, EventDamage: EventDamageSnapshot{HasKilled: true, Killed: .5}},
	} {
		if value, err := reg.evaluate(0, context); err == nil {
			t.Fatal("missing or invalid kill fact was accepted", context, value)
		}
	}
}

func TestEvalActualHPLossRequiresTheReceivedDamageFactAndKeepsZero(t *testing.T) {
	reg := mustCompileFormula(t, model.GenericFormulaExpr{Op: "read", Path: "event.damage.actualHpLoss"})
	for _, actual := range []float64{0, 12.5} {
		value, err := reg.evaluate(0, GenericEvalContext{HasEventContext: true, HasEventDamageSnapshot: true, EventDamage: EventDamageSnapshot{HasActualHPLoss: true, ActualHPLoss: actual, MitigatedAmount: 123}})
		if err != nil || value != actual {
			t.Fatal(actual, value, err)
		}
	}
	for _, context := range []GenericEvalContext{{}, {HasEventContext: true}, {HasEventContext: true, HasEventDamageSnapshot: true, EventDamage: EventDamageSnapshot{MitigatedAmount: 123}}} {
		if _, err := reg.evaluate(0, context); err == nil {
			t.Fatal("missing actual HP damage became a zero")
		}
	}
}

func TestCompileC1RejectsUnknownDamageTypeAndEventDamagePaths(t *testing.T) {
	var errors []model.EngineError
	addError := func(code model.GenericErrCode, path, message, ref string) {
		errors = append(errors, model.EngineError{Code: code})
	}
	for _, path := range []string{"damage.type.", "event.damage.unknownField", "damage.trait."} {
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
	got, err := reg.evaluate(0, GenericEvalContext{
		HasDamageContext: true,
		DamageTraits:     BorrowStringView([]string{"damage_trait/on_hit"}),
	})
	if err != nil || got != 1 {
		t.Fatalf("trait match got=%v err=%v", got, err)
	}
	got, err = reg.evaluate(0, GenericEvalContext{
		HasDamageContext: true,
		DamageTraits:     BorrowStringView([]string{"damage_trait/proc"}),
	})
	if err != nil || got != 0 {
		t.Fatalf("trait miss got=%v err=%v", got, err)
	}
	if _, err := reg.evaluate(0, GenericEvalContext{}); err == nil {
		t.Fatal("expected fail closed without damage context")
	}

	reg = mustCompileFormula(t, model.GenericFormulaExpr{Op: "read", Path: "damage.type.damage/magical"})
	got, err = reg.evaluate(0, GenericEvalContext{HasDamageContext: true, DamageTypeKey: "damage/magical"})
	if err != nil || got != 1 {
		t.Fatalf("raw type got=%v err=%v", got, err)
	}

	reg = mustCompileFormula(t, model.GenericFormulaExpr{Op: "read", Path: "event.damage.mitigatedAmount"})
	got, err = reg.evaluate(0, GenericEvalContext{
		HasEventContext:        true,
		HasEventDamageSnapshot: true,
		EventDamage:            EventDamageSnapshot{MitigatedAmount: 42},
	})
	if err != nil || got != 42 {
		t.Fatalf("event.damage got=%v err=%v", got, err)
	}
	if _, err := reg.evaluate(0, GenericEvalContext{HasEventContext: true}); err == nil {
		t.Fatal("expected fail closed without damage snapshot")
	}
}
