package execution

import (
	"strings"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func TestProcessActualChargeCooldownReductionValidatesDynamicMilliseconds(t *testing.T) {
	read := func() model.GenericFormulaExpr {
		return model.GenericFormulaExpr{Op: "read", Path: "use.charge_duration_ms"}
	}
	for _, spec := range []struct {
		name      string
		amount    model.GenericFormulaExpr
		reject    bool
		wantReady int64
	}{
		{name: "negative", amount: model.GenericFormulaExpr{Op: "sub", Args: []model.GenericFormulaExpr{authoringConst(0), read()}}, reject: true},
		{name: "zero", amount: model.GenericFormulaExpr{Op: "sub", Args: []model.GenericFormulaExpr{read(), read()}}, wantReady: 1000},
		{name: "more_than_remaining", amount: model.GenericFormulaExpr{Op: "mul", Args: []model.GenericFormulaExpr{read(), authoringConst(10)}}, wantReady: 200},
		{name: "fractional", amount: model.GenericFormulaExpr{Op: "div", Args: []model.GenericFormulaExpr{read(), authoringConst(3)}}, reject: true},
		{name: "unsafe", amount: model.GenericFormulaExpr{Op: "mul", Args: []model.GenericFormulaExpr{read(), authoringConst(1e20)}}, reject: true},
	} {
		t.Run(spec.name, func(t *testing.T) {
			c, r := processBase(t, "CHARGE")
			process := &c.SharedProviders[0].Processes[0]
			process.Costs = nil
			process.Cooldown = &model.ProcessCooldownDefinition{DurationMs: *timedShieldExpr(1000), StartMoment: processMoment("PROCESS_START", "", "")}
			process.MomentOperations = []model.ProcessMomentOperations{{Moment: processMoment("STEP_EXECUTION", "s1", ""), Operations: []model.OperationDefinition{
				{Operation: "cooldown_change", Target: "source", AbilityRef: timedShieldRef("start"), ValuePolicy: "reduce", Amount: &spec.amount},
			}}}
			processEntry(&r, "release", "advance", "u1", 200)
			r.StopPolicy.DurationMs = 300
			compiled := compile.CompileGeneric(c)
			if !compiled.OK {
				t.Fatal("valid dynamic charge formula was not compiled", compiled.Result.Errors)
			}
			done, err := runForTest(compiled.Session, r)
			if spec.reject {
				if err == nil || !strings.Contains(err.Message, "safe integer milliseconds") {
					t.Fatal("invalid dynamic reduction did not fail", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if ready := parseCooldownReadyAtMs(done.FinalSnapshot.Combatants[0].Cooldowns[timedShieldRef("start")]); ready != spec.wantReady {
				t.Fatalf("ready=%d want=%d", ready, spec.wantReady)
			}
		})
	}
}
