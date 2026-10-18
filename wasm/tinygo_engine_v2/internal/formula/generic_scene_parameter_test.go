package formula

import (
	"fmt"
	"math"
	"testing"
	"unsafe"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func frozenSceneFormula(key, skill, valueType string, value float64) model.NamedFormula {
	def := formuladefinition.FromExpr(key, skill, model.GenericFormulaExpr{Op: "read", Path: "ability.param.initial_count"}, nil)
	def.Parameters[0].ValueType = valueType
	def.Parameters[0].RuntimeSource = &model.FormulaRuntimeSource{Kind: "scene_parameter", Value: model.Float64Ptr(value)}
	return def
}

func TestSceneParameterFreezesPrivateValuesBeforeStaticAndRuntimeContextChecks(t *testing.T) {
	defs := []model.NamedFormula{
		frozenSceneFormula("first_initial", "unrelated_skill_alpha", "INTEGER", 0),
		frozenSceneFormula("second_initial", "different_skill_beta", "DECIMAL", -2.5),
	}
	var registry GenericRegistry
	CompileDeclaredNamedFormulas(defs, nil, &registry, func(c model.GenericErrCode, p, m, r string) { t.Fatal(c, p) })
	for i, want := range []float64{0, -2.5} {
		id := GenericProgramID(i)
		if deps := registry.ReadDependencies(id); len(deps) != 0 {
			t.Fatal("frozen input gained a runtime dependency", deps)
		}
		if got, ok := registry.FoldStatic(id); !ok || got != want {
			t.Fatal("scene value did not fold", i, got, ok)
		}
		for _, ctx := range []GenericEvalContext{
			{},
			{RuntimeSkillKey: "foreign", AbilityParams: map[string]float64{"initial_count": 999}, RuntimeParameters: map[string]float64{"initial_count": 888}, HasUseChargeDuration: true, UseChargeDurationMs: 777},
		} {
			if got, err := registry.Eval(id, ctx); err != nil || got != want {
				t.Fatal("runtime context changed a frozen scene input", i, got, err)
			}
		}
	}
	for i := range defs {
		source := defs[i].Parameters[0].RuntimeSource
		*source.Value = math.NaN()
		source.Value, source.Kind, source.ResourceKey = model.Float64Ptr(345), "ability_parameter", "mana"
		defs[i].Parameters[0].Value = model.Float64Ptr(678)
	}
	for i, want := range []float64{0, -2.5} {
		if got, err := registry.Eval(GenericProgramID(i), GenericEvalContext{}); err != nil || got != want {
			t.Fatal("compiled binding aliased caller DTO pointers", got, err)
		}
		if got, ok := registry.FoldStatic(GenericProgramID(i)); !ok || got != want {
			t.Fatal("caller mutation changed static folding", got, ok)
		}
	}
}

func TestSceneParameterValidatesFiniteValuesAndDeclaredSafeIntegersAtCompileTime(t *testing.T) {
	for _, valueType := range []string{"INTEGER", "DECIMAL"} {
		for _, value := range []float64{0, 1, -5, .25, -.5, 9007199254740991, -9007199254740991, 9007199254740992, -9007199254740992, 1e100, math.NaN(), math.Inf(1), math.Inf(-1)} {
			t.Run(fmt.Sprint(valueType, "/", value), func(t *testing.T) {
				def := frozenSceneFormula("initial", "any_authored_skill", valueType, value)
				var registry GenericRegistry
				var problems []string
				CompileDeclaredNamedFormulas([]model.NamedFormula{def}, nil, &registry, func(c model.GenericErrCode, p, m, r string) { problems = append(problems, string(c)+":"+p) })
				valid := !math.IsNaN(value) && !math.IsInf(value, 0) && (valueType == "DECIMAL" || math.Trunc(value) == value && math.Abs(value) <= 9007199254740991)
				if valid != (len(problems) == 0) || valid != (len(registry.Programs) == 1) {
					t.Fatal(valid, problems, len(registry.Programs))
				}
				if !valid {
					if len(problems) != 1 || problems[0] != "FORMULA_INVALID_STRUCTURE:/formulas/0/parameters/0/runtimeSource" {
						t.Fatal(problems)
					}
					return
				}
				if got, ok := registry.FoldStatic(0); !ok || got != value {
					t.Fatal(value, got, ok)
				}
			})
		}
	}
}

func TestSceneParameterRejectsWrongSourceDetailsAndPreservesLegacyReads(t *testing.T) {
	for _, scenario := range []string{"missing", "resource", "top_level_value", "fixed", "level", "character_level", "unknown_kind"} {
		t.Run(scenario, func(t *testing.T) {
			def := frozenSceneFormula("initial", "any_authored_skill", "INTEGER", 0)
			switch scenario {
			case "missing":
				def.Parameters[0].RuntimeSource.Value = nil
			case "resource":
				def.Parameters[0].RuntimeSource.ResourceKey = "mana"
			case "top_level_value":
				def.Parameters[0].Value = model.Float64Ptr(0)
			case "fixed":
				def.Parameters[0].ValueMode, def.Parameters[0].Value = "FIXED", model.Float64Ptr(0)
			case "level":
				def.Parameters[0].ValueMode, def.Parameters[0].Value = "SKILL_LEVEL", model.Float64Ptr(0)
			case "character_level":
				def.Parameters[0].ValueMode, def.Parameters[0].Value = "CHARACTER_LEVEL", model.Float64Ptr(0)
			case "unknown_kind":
				def.Parameters[0].RuntimeSource.Kind = "guess"
			}
			var registry GenericRegistry
			problems := 0
			CompileDeclaredNamedFormulas([]model.NamedFormula{def}, nil, &registry, func(c model.GenericErrCode, p, m, r string) { problems++ })
			if problems == 0 || len(registry.Programs) != 0 {
				t.Fatal("invalid source registered", scenario)
			}
		})
	}
	for _, kind := range []string{"use_charge_duration", "process_actual_cost", "ability_parameter"} {
		t.Run(kind, func(t *testing.T) {
			def := frozenSceneFormula("legacy", "same_skill", "DECIMAL", 0)
			source := def.Parameters[0].RuntimeSource
			source.Kind, source.Value = kind, nil
			ctx := GenericEvalContext{RuntimeSkillKey: "same_skill", HasUseChargeDuration: true, UseChargeDurationMs: 7, HasProcessActualCosts: true, ProcessActualCosts: map[string]float64{"mana": 7}, AbilityParams: map[string]float64{"initial_count": 7}}
			if kind == "process_actual_cost" {
				source.ResourceKey = "mana"
			}
			var registry GenericRegistry
			CompileDeclaredNamedFormulas([]model.NamedFormula{def}, nil, &registry, func(c model.GenericErrCode, p, m, r string) { t.Fatal(c, p) })
			if len(registry.ReadDependencies(0)) != 1 {
				t.Fatal("legacy runtime dependency lost", kind)
			}
			if _, ok := registry.FoldStatic(0); ok {
				t.Fatal("legacy dynamic input became static", kind)
			}
			if got, err := registry.Eval(0, ctx); err != nil || got != 7 {
				t.Fatal(kind, got, err)
			}
			ctx.RuntimeSkillKey = "foreign"
			if _, err := registry.Eval(0, ctx); err == nil {
				t.Fatal("legacy source lost skill-context guard", kind)
			}
			source.Value = model.Float64Ptr(0)
			var invalid GenericRegistry
			problems := 0
			CompileDeclaredNamedFormulas([]model.NamedFormula{def}, nil, &invalid, func(c model.GenericErrCode, p, m, r string) { problems++ })
			if problems == 0 || len(invalid.Programs) != 0 {
				t.Fatal("legacy source accepted scene value", kind)
			}
		})
	}
}

func TestSceneParameterFrozenStorageRemainsChargedToFormulaBudget(t *testing.T) {
	scene := frozenSceneFormula("initial", "same_skill", "DECIMAL", 0)
	fixed := frozenSceneFormula("initial", "same_skill", "DECIMAL", 0)
	fixed.Parameters[0].ValueMode, fixed.Parameters[0].Value, fixed.Parameters[0].RuntimeSource = "FIXED", model.Float64Ptr(0), nil
	var sceneRegistry, fixedRegistry GenericRegistry
	add := func(c model.GenericErrCode, p, m, r string) { t.Fatal(c, p) }
	CompileDeclaredNamedFormulas([]model.NamedFormula{scene}, nil, &sceneRegistry, add)
	CompileDeclaredNamedFormulas([]model.NamedFormula{fixed}, nil, &fixedRegistry, add)
	wantExtra := uint64(unsafe.Sizeof(model.FormulaRuntimeSource{})) + uint64(len("scene_parameter")) + uint64(len("RUNTIME_INPUT")-len("FIXED"))
	if sceneRegistry.Programs[0].BindingBytes != fixedRegistry.Programs[0].BindingBytes+wantExtra {
		t.Fatal("source or nested frozen scalar was not budgeted", sceneRegistry.Programs[0].BindingBytes, fixedRegistry.Programs[0].BindingBytes, wantExtra)
	}
}
