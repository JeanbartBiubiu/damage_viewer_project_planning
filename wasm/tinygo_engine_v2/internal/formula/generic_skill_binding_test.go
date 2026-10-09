package formula

import (
	"encoding/json"
	"math"
	"testing"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func TestPhase3BAttributeKindsExplicitSlotsAndUnselectedDynamicZero(t *testing.T) {
	for kind, want := range map[string]float64{"BASE": 3, "BONUS": 5, "TOTAL": 8, "CURRENT": 2, "MAX": 10, "MISSING": 8, "CURRENT_RATIO": .2, "MISSING_RATIO": .8} {
		def := model.NamedFormula{Key: kind, SkillKey: "skill", Expression: formuladefinition.Definition([]any{map[string]any{"key": "value", "binding": map[string]any{"kind": "attribute", "object": "target", "attributeKey": "original_armor", "valueKind": kind, "view": "current_frame"}}}, []any{formuladefinition.Stage("output", map[string]any{"op": "read", "inputKey": "value"})}, "output"), Parameters: []model.FormulaParameter{}}
		var registry GenericRegistry
		CompileSkillNamedFormulas([]model.NamedFormula{def}, []string{"original_armor"}, &registry, func(c model.GenericErrCode, p, m, r string) { t.Fatal(c, p) })
		ctx := GenericEvalContext{TargetAttrs: map[string]model.AttributeSlotDef{"original_armor": {Base: 3, Resolved: 8, Current: 2, Max: 10}}}
		value, err := registry.Eval(0, ctx)
		if err != nil || math.Abs(value-want) > 1e-12 {
			t.Fatal(kind, value, err)
		}
		var partial model.AttributeSlotDef
		if err := json.Unmarshal([]byte(`{"base":3,"resolved":8,"current":2}`), &partial); err != nil {
			t.Fatal(err)
		}
		ctx.TargetAttrs["original_armor"] = partial
		_, err = registry.Eval(0, ctx)
		requiresMax := kind == "MAX" || kind == "MISSING" || kind == "CURRENT_RATIO" || kind == "MISSING_RATIO"
		if requiresMax != (err != nil) {
			t.Fatal(kind, "max inferred from other fields", err)
		}
	}
	def := formuladefinition.FromExpr("dynamic", "skill", model.GenericFormulaExpr{Op: "read", Path: "ability.param.p"}, nil)
	var registry GenericRegistry
	CompileSkillNamedFormulas([]model.NamedFormula{def}, nil, &registry, func(c model.GenericErrCode, p, m, r string) { t.Fatal(c, p) })
	for _, ctx := range []GenericEvalContext{{AbilityParams: map[string]float64{"p": 99}}, {RuntimeSkillKey: "foreign", RuntimeParameters: map[string]float64{"p": 0}}} {
		if _, err := registry.Eval(0, ctx); err == nil {
			t.Fatal("runtime parameter borrowed untrusted or foreign params")
		}
	}
	value, err := registry.Eval(0, GenericEvalContext{RuntimeSkillKey: "skill", RuntimeParameters: map[string]float64{"p": 0}})
	if err != nil || value != 0 {
		t.Fatal("actual zero became missing", value, err)
	}
}
