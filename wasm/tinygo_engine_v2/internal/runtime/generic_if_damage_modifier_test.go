package runtime

import (
	"math"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func runtimeIfConst(v float64) model.GenericFormulaExpr {
	return model.GenericFormulaExpr{Op: "const", Value: &v}
}

func runtimeIfRead(path string) model.GenericFormulaExpr {
	return model.GenericFormulaExpr{Op: "read", Path: path}
}

func runtimeIf(condition, yes, no model.GenericFormulaExpr) model.GenericFormulaExpr {
	return model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{condition, yes, no}}
}

func runtimeHPCompare(op string, threshold float64) model.GenericFormulaExpr {
	ratio := model.GenericFormulaExpr{Op: "div", Args: []model.GenericFormulaExpr{
		runtimeIfRead("target.attr.hp.current"), runtimeIfRead("target.attr.hp.max"),
	}}
	return model.GenericFormulaExpr{Op: op, Args: []model.GenericFormulaExpr{ratio, runtimeIfConst(threshold)}}
}

func runtimeModifierSum(highAmount model.GenericFormulaExpr) model.GenericFormulaExpr {
	other := model.GenericFormulaExpr{Op: "eq", Args: []model.GenericFormulaExpr{
		runtimeIfRead(model.FormulaPathDamageSelf), runtimeIfConst(0),
	}}
	low := runtimeIf(other, runtimeIf(runtimeHPCompare("lt", .4), runtimeIfConst(.08), runtimeIfConst(0)), runtimeIfConst(0))
	high := runtimeIf(other, runtimeIf(runtimeHPCompare("gt", .6), highAmount, runtimeIfConst(0)), runtimeIfConst(0))
	return model.GenericFormulaExpr{Op: "add", Args: []model.GenericFormulaExpr{
		runtimeIfConst(1), {Op: "add", Args: []model.GenericFormulaExpr{low, high}},
	}}
}

func runtimeGroupedModifier(value model.GenericFormulaExpr) model.ModifierDefinition {
	mod := magnificationModifier(1)
	mod.ModifierKey = "health_gate_group"
	mod.Value = value
	return mod
}

func TestPipelineDamageModifierConditionalSumSkipsInactiveAmounts(t *testing.T) {
	for _, tc := range []struct {
		hp, raw float64
	}{
		{399, 108}, {400, 100}, {500, 100}, {600, 100}, {601, 106},
	} {
		t.Run(itoaRuntime(int(tc.hp)), func(t *testing.T) {
			c, r := loadPipelineDamageFixture(t, 100, 0)
			setCombatantAttr(&c, &r, model.SelectorTarget, "hp", model.AttributeSlotDef{
				Base: 1000, Current: tc.hp, Max: 1000, Resolved: tc.hp,
			})
			mountPipelineProvider(&c, &r, model.SelectorSource, "item:health_gate_group", "health_gate_group",
				runtimeGroupedModifier(runtimeModifierSum(runtimeIfConst(.06))))
			done := runPipelineFixture(t, c, r)
			data := firstOriginalDamage(t, done)
			if got := evidenceDataFloat(data, "rawAmount"); math.Abs(got-tc.raw) > 1e-9 {
				t.Fatalf("hp=%v raw=%v want=%v", tc.hp, got, tc.raw)
			}
			if len(damageEvidenceModifiers(data)) != 1 {
				t.Fatalf("expected one grouped modifier, got %v", damageEvidenceModifiers(data))
			}
		})
	}
}

func TestPipelineDamageModifierIfShortCircuitsIdentityAndInactiveAmount(t *testing.T) {
	missing := runtimeIfRead("source.attr.unavailable_gate.current")
	c, r := loadPipelineDamageFixture(t, 100, 0)
	setCombatantAttr(&c, &r, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 1000, Current: 399, Max: 1000, Resolved: 399,
	})
	mountPipelineProvider(&c, &r, model.SelectorSource, "item:conditional_missing", "conditional_missing",
		runtimeGroupedModifier(runtimeModifierSum(missing)))
	done := runPipelineFixture(t, c, r)
	if got := evidenceDataFloat(firstOriginalDamage(t, done), "rawAmount"); math.Abs(got-108) > 1e-9 {
		t.Fatalf("inactive amount was evaluated: raw=%v", got)
	}

	setCombatantAttr(&c, &r, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 1000, Current: 601, Max: 1000, Resolved: 601,
	})
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatalf("compile: %+v", compiled.Result.Errors)
	}
	r.ExpectedRulesHash = compiled.Session.RulesHash
	_, err := RunGeneric(compiled.Session, r)
	if err == nil || !strings.Contains(err.Message, "unavailable_gate") {
		t.Fatalf("selected missing amount error=%+v", err)
	}

	selfC, selfR := loadPipelineDamageFixture(t, 100, 0)
	selfC.SharedProviders[0].Abilities[0].Operations[0].Target = model.SelectorSource
	other := model.GenericFormulaExpr{Op: "eq", Args: []model.GenericFormulaExpr{
		runtimeIfRead(model.FormulaPathDamageSelf), runtimeIfConst(0),
	}}
	mountPipelineProvider(&selfC, &selfR, model.SelectorSource, "item:self_guard", "self_guard",
		runtimeGroupedModifier(runtimeIf(other, runtimeIfRead("target.attr.hp_missing.current"), runtimeIfConst(1))))
	selfDone := runPipelineFixture(t, selfC, selfR)
	if got := evidenceDataFloat(firstOriginalDamage(t, selfDone), "rawAmount"); math.Abs(got-100) > 1e-9 {
		t.Fatalf("self guard read missing health: raw=%v", got)
	}
}
