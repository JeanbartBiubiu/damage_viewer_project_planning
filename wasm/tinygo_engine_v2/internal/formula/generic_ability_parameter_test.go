package formula

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func abilityParameterFormula(expr model.GenericFormulaExpr, valueType string) model.NamedFormula {
	def := formuladefinition.FromExpr("authored_value", "unrelated_skill", expr, nil)
	for i := range def.Parameters {
		def.Parameters[i].RuntimeSource = &model.FormulaRuntimeSource{Kind: "ability_parameter"}
		def.Parameters[i].ValueType = valueType
	}
	return def
}

func TestAuthoredAbilityParameterRetainsSourceAndStrictSkillIdentity(t *testing.T) {
	def := abilityParameterFormula(model.GenericFormulaExpr{Op: "read", Path: "ability.param.scene_value"}, "DECIMAL")
	var registry programStore
	compileDeclaredNamedFormulas([]model.NamedFormula{def}, nil, &registry, func(c model.GenericErrCode, p, m, r string) { t.Fatal(c, p) })
	deps := registry.readDependencies(0)
	if len(deps) != 1 || deps[0].ReadKind != ReadAuthoredAbilityParameter || deps[0].ReadKey != "scene_value" {
		t.Fatal("runtime source was lowered to unrestricted ability.param", deps)
	}
	if _, static := registry.foldStatic(0); static {
		t.Fatal("runtime ability parameter folded as static")
	}
	if _, cacheable := registry.attributeCacheDependencies(0); cacheable {
		t.Fatal("runtime ability parameter entered stable attribute cache")
	}
	for _, ctx := range []GenericEvalContext{
		{AbilityParams: model.BorrowNumericView(map[string]float64{"scene_value": 0})},
		{RuntimeSkillKey: "foreign", AbilityParams: model.BorrowNumericView(map[string]float64{"scene_value": 0})},
		{RuntimeSkillKey: "unrelated_skill", RuntimeParameters: model.BorrowNumericView(map[string]float64{"scene_value": 0})},
		{RuntimeSkillKey: "unrelated_skill", AbilityParams: model.BorrowNumericView(map[string]float64{"other_value": 0})},
		{RuntimeSkillKey: "unrelated_skill", AbilityParams: model.BorrowNumericView(map[string]float64{"scene_value": math.Inf(1)})},
		{RuntimeSkillKey: "unrelated_skill", AbilityParams: model.BorrowNumericView(map[string]float64{"scene_value": math.NaN()})},
	} {
		if _, err := registry.evaluate(0, ctx); err == nil {
			t.Fatal("missing, foreign or non-finite ability parameter accepted", ctx)
		}
	}
	for _, value := range []float64{0, 0.5, -2} {
		got, err := registry.evaluate(0, GenericEvalContext{RuntimeSkillKey: "unrelated_skill", AbilityParams: model.BorrowNumericView(map[string]float64{"scene_value": value})})
		if err != nil || got != value {
			t.Fatal(got, err)
		}
	}
}

func TestAuthoredAbilityParameterIntegerIsCheckedOnlyWhenActuallyRead(t *testing.T) {
	for _, selected := range []bool{false, true} {
		flag := 0.0
		if selected {
			flag = 1
		}
		expr := model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{{Op: "const", Value: &flag}, {Op: "read", Path: "ability.param.segments"}, {Op: "const", Value: model.Float64Ptr(17)}}}
		def := abilityParameterFormula(expr, "INTEGER")
		var registry programStore
		compileDeclaredNamedFormulas([]model.NamedFormula{def}, nil, &registry, func(c model.GenericErrCode, p, m, r string) { t.Fatal(c, p) })
		for _, value := range []float64{0, 2, 9007199254740991, -9007199254740991, 0.5, 9007199254740992, -9007199254740992, math.Inf(1), math.NaN()} {
			got, err := registry.evaluate(0, GenericEvalContext{RuntimeSkillKey: "unrelated_skill", AbilityParams: model.BorrowNumericView(map[string]float64{"segments": value})})
			valid := !selected || !math.IsNaN(value) && !math.IsInf(value, 0) && math.Trunc(value) == value && math.Abs(value) <= 9007199254740991
			if valid != (err == nil) || !selected && got != 17 || selected && valid && got != value {
				t.Fatal(selected, value, got, err)
			}
		}
		got, err := registry.evaluate(0, GenericEvalContext{RuntimeSkillKey: "unrelated_skill"})
		if selected == (err == nil) || !selected && got != 17 {
			t.Fatal("missing parameter changed lazy branch semantics", selected, got, err)
		}
	}
}
