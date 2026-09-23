package compile

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func timedShieldExpr(v float64) *model.GenericFormulaExpr {
	return &model.GenericFormulaExpr{Op: "const", Value: model.Float64Ptr(v)}
}

func timedShieldOp(amount, duration float64) model.OperationDefinition {
	return model.OperationDefinition{
		Operation:        "shield",
		Target:           "target",
		Amount:           timedShieldExpr(amount),
		ShieldRef:        "eclipse",
		ShieldDurationMs: timedShieldExpr(duration),
	}
}

func TestCompileTimedShieldProjectsDurationFormula(t *testing.T) {
	req := minimalValidCompileRequest()
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{timedShieldOp(80, 2000)}
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	op := result.Session.Operations[0]
	if op.Operation != "shield" || !op.HasShieldDuration || !op.HasAmount {
		t.Fatalf("compiled op=%+v", op)
	}
	key := "sharedProviders[0].abilities[0].operations[0].shieldDurationMs"
	if _, ok := result.Session.Formulas.Index[key]; !ok {
		t.Fatalf("missing duration formula %q in %+v", key, result.Session.Formulas.Index)
	}
}

func TestCompileTimedShieldOmittedKeepsUntimed(t *testing.T) {
	req := minimalValidCompileRequest()
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{
		Operation: "shield",
		Target:    "target",
		Amount:    timedShieldExpr(80),
		ShieldRef: "eclipse",
	}}
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	if result.Session.Operations[0].HasShieldDuration {
		t.Fatal("omitted shieldDurationMs should stay untimed")
	}
}

func TestCompileTimedShieldRejectsOtherOperations(t *testing.T) {
	ops := []model.OperationDefinition{
		{Operation: "damage", Target: "target", DamageType: "damage/physical", Amount: timedShieldExpr(10), ShieldDurationMs: timedShieldExpr(2000)},
		{Operation: "heal", Target: "target", Amount: timedShieldExpr(10), ShieldDurationMs: timedShieldExpr(2000)},
	}
	for _, op := range ops {
		req := minimalValidCompileRequest()
		req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{op}
		result := CompileGeneric(req)
		if result.OK {
			t.Fatalf("expected failure for %s", op.Operation)
		}
		if !hasErrorPath(result.Result.Errors, "shieldDurationMs") {
			t.Fatalf("%s errors=%+v", op.Operation, result.Result.Errors)
		}
	}
}

func TestCompileTimedShieldRejectsIllegalConstants(t *testing.T) {
	cases := []struct {
		name  string
		expr  *model.GenericFormulaExpr
		value float64
	}{
		{"zero", timedShieldExpr(0), 0},
		{"negative", timedShieldExpr(-1), -1},
		{"fraction", timedShieldExpr(1.5), 1.5},
		{"two_pow_63", timedShieldExpr(9223372036854775808.0), 9223372036854775808.0},
		{"pos_inf", timedShieldExpr(math.Inf(1)), math.Inf(1)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := minimalValidCompileRequest()
			op := timedShieldOp(80, 2000)
			op.ShieldDurationMs = tc.expr
			req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{op}
			result := CompileGeneric(req)
			if result.OK {
				t.Fatal("expected compile failure")
			}
			if !hasErrorPath(result.Result.Errors, "shieldDurationMs") {
				t.Fatalf("errors=%+v", result.Result.Errors)
			}
		})
	}
}

func TestCompileTimedShieldFoldsAddConstants(t *testing.T) {
	req := minimalValidCompileRequest()
	op := timedShieldOp(80, 2000)
	op.ShieldDurationMs = &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: model.Float64Ptr(1000)},
			{Op: "const", Value: model.Float64Ptr(1000)},
		},
	}
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{op}
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	if !result.Session.Operations[0].HasShieldDuration {
		t.Fatal("expected folded duration program")
	}
}

func TestCompileTimedShieldRejectsFoldedNonInteger(t *testing.T) {
	req := minimalValidCompileRequest()
	op := timedShieldOp(80, 2000)
	op.ShieldDurationMs = &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: model.Float64Ptr(0.25)},
			{Op: "const", Value: model.Float64Ptr(0.25)},
		},
	}
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{op}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected compile failure")
	}
	if !hasErrorPath(result.Result.Errors, "shieldDurationMs") {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
}

func TestCompileTimedShieldAllowsDynamicRead(t *testing.T) {
	req := minimalValidCompileRequest()
	op := timedShieldOp(80, 2000)
	op.ShieldDurationMs = &model.GenericFormulaExpr{Op: "read", Path: "ability.param.shield_duration_ms"}
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{op}
	req.SharedProviders[0].Abilities[0].Params = map[string]float64{"baseDamage": 100, "shield_duration_ms": 2000}
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	if !result.Session.Operations[0].HasShieldDuration {
		t.Fatal("expected duration program for dynamic read")
	}
}

func TestCompileTimedShieldRejectsResolveEntryField(t *testing.T) {
	req := minimalValidCompileRequest()
	skillHitTypes(&req)
	ability := hitAbility()
	ability.Operations[0].ShieldDurationMs = timedShieldExpr(100)
	req.SharedProviders[0].Abilities = []model.AbilityDefinition{ability}
	result := CompileGeneric(req)
	if result.OK || !hasErrorPath(result.Result.Errors, "shieldDurationMs") {
		t.Fatalf("resolve entry must reject shield-only field: %+v", result.Result.Errors)
	}
}
