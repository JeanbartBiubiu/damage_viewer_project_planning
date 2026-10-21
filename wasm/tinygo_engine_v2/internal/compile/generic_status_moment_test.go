package compile

import (
	"strings"
	"testing"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func momentSlowStrength() model.GenericFormulaExpr {
	return model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{
		{Op: "lt", Args: []model.GenericFormulaExpr{{Op: "read", Path: "provider.elapsed_ms"}, statusConst(1000)}},
		statusConst(0), statusConst(.6),
	}}
}

func momentSlowCompileInput() model.CompileRequest {
	r := minimalValidCompileRequest()
	r.SharedProviders = append(r.SharedProviders, model.ProviderDefinition{
		ProviderKey: "landing_slow", Kind: "status", StableID: "landing_slow", SkillKey: "configured_skill",
		Lifecycle: sourceTargetLifecycle(2500),
		StatusContributions: []model.StatusContributionDefinition{{ResultRef: "slow", StatusKey: "landing", StatusKind: model.StatusKindMovementSlow,
			ValueReadMode: model.StatusValueReadMomentEvaluation, Strength: momentSlowStrength()}},
	})
	return r
}

func momentSlowAuthoredFormula(extraBranch any) model.NamedFormula {
	late := formuladefinition.Const(.6)
	inputs := []any{map[string]any{"key": "elapsed", "binding": map[string]any{"kind": "context", "contextKey": "effect_elapsed_ms"}}}
	if extraBranch != nil {
		late = extraBranch
	}
	return model.NamedFormula{Key: "authored_landing", Scope: "skill", SkillKey: "configured_skill", Parameters: []model.FormulaParameter{},
		Expression: formuladefinition.Definition(inputs, []any{formuladefinition.Stage("out", map[string]any{"op": "if", "args": []any{
			map[string]any{"op": "lt", "args": []any{map[string]any{"op": "read", "inputKey": "elapsed"}, formuladefinition.Const(1000)}}, formuladefinition.Const(0), late,
		}})}, "out")}
}

func TestCompileMomentSlowAuthorizesOnlyExplicitActualInstanceMode(t *testing.T) {
	for _, shape := range []string{"inline", "common", "static_constant", "frozen_parameter"} {
		t.Run(shape, func(t *testing.T) {
			r := momentSlowCompileInput()
			switch shape {
			case "common":
				r.Formulas = []model.NamedFormula{momentSlowAuthoredFormula(nil)}
				r.SharedProviders[1].StatusContributions[0].Strength = model.GenericFormulaExpr{Op: "ref", Ref: "authored_landing"}
			case "static_constant":
				r.SharedProviders[1].StatusContributions[0].Strength = statusConst(.6)
			case "frozen_parameter":
				r.Formulas = []model.NamedFormula{formuladefinition.FromExpr("frozen", "configured_skill", model.GenericFormulaExpr{Op: "read", Path: "ability.param.selected_strength"}, map[string]float64{"selected_strength": .6})}
				r.SharedProviders[1].StatusContributions[0].Strength = model.GenericFormulaExpr{Op: "ref", Ref: "frozen"}
			}
			compiled := CompileGeneric(r)
			if !compiled.OK {
				t.Fatal(compiled.Result.Errors)
			}
			provider := compiled.Session.Providers[1]
			if !provider.HasMomentStatus || !provider.NeedsElapsedTime || !compiled.Session.HasProviderElapsedReads {
				t.Fatal("explicit constant mode must retain the same actual-instance guard", provider)
			}
			for _, elapsed := range []int64{0, 999, 1000, 2499} {
				value, err := compiled.Session.Formulas.Eval(provider.StatusContributions[0].StrengthProgram, formula.GenericEvalContext{StrictReads: true, HasProviderContext: true, HasProviderElapsed: true, ProviderElapsedMs: elapsed})
				want := .6
				if elapsed < 1000 && (shape == "inline" || shape == "common") {
					want = 0
				}
				if err != nil || value != want {
					t.Fatal(shape, elapsed, value, want, err)
				}
			}
		})
	}
}

func TestCompileMomentSlowRejectsScopeAndOtherResultEscapes(t *testing.T) {
	cases := []struct {
		name   string
		change func(*model.CompileRequest)
	}{
		{"omitted_mode", func(r *model.CompileRequest) { r.SharedProviders[1].StatusContributions[0].ValueReadMode = "" }},
		{"explicit_snapshot", func(r *model.CompileRequest) {
			r.SharedProviders[1].StatusContributions[0].ValueReadMode = model.StatusValueReadApplicationSnapshot
		}},
		{"unknown_mode", func(r *model.CompileRequest) { r.SharedProviders[1].StatusContributions[0].ValueReadMode = "LIVE" }},
		{"infinite", func(r *model.CompileRequest) { r.SharedProviders[1].Lifecycle = nil }},
		{"multilayer", func(r *model.CompileRequest) { r.SharedProviders[1].Lifecycle.MaxStacks = 2 }},
		{"unscoped", func(r *model.CompileRequest) { r.SharedProviders[1].Lifecycle.InstanceScope = "" }},
		{"extend", func(r *model.CompileRequest) { r.SharedProviders[1].Lifecycle.RefreshPolicy = "extend" }},
		{"tick", func(r *model.CompileRequest) { r.SharedProviders[1].Lifecycle.TickIntervalMs = 500 }},
		{"another_result", func(r *model.CompileRequest) {
			other := r.SharedProviders[1].StatusContributions[0]
			other.ResultRef = "another"
			r.SharedProviders[1].StatusContributions = append(r.SharedProviders[1].StatusContributions, other)
		}},
		{"attribute_modifier", func(r *model.CompileRequest) {
			r.SharedProviders[1].Modifiers = []model.ModifierDefinition{{ModifierKey: "extra", Kind: "attribute", Target: "self.attr.attack_damage", ValuePolicy: "add", Value: statusConst(1)}}
		}},
		{"active", func(r *model.CompileRequest) {
			r.SharedProviders[1].Abilities = []model.AbilityDefinition{{AbilityKey: "extra", Kind: "active"}}
		}},
		{"process", func(r *model.CompileRequest) {
			r.SharedProviders[1].Processes = []model.ProcessDefinition{{ProcessKey: "extra", SkillKey: "configured_skill", Steps: []model.ProcessStepDefinition{{StepKey: "instant", StepType: "IMMEDIATE"}}, Costs: []model.ProcessCostDefinition{}, MomentOperations: []model.ProcessMomentOperations{}}}
		}},
		{"listener", func(r *model.CompileRequest) {
			r.SharedProviders[1].Listeners = []model.ListenerDefinition{{ListenerKey: "extra", EventMatcher: model.TypeMatcher{All: []string{"event/ability_started"}}, Operations: []model.OperationDefinition{{Operation: "heal", Target: "self", Amount: statusDurationForMoment(.1)}}}}
		}},
		{"state", func(r *model.CompileRequest) {
			r.SharedProviders[1].InitialStateSchema = map[string]any{"hidden": map[string]any{"valueType": "number", "defaultValue": 0}}
		}},
		{"initial_mount", func(r *model.CompileRequest) {
			r.Combatants[1].Providers = append(r.Combatants[1].Providers, model.CombatantProviderMount{ProviderRef: "forged", DefinitionRef: "landing_slow"})
		}},
		{"ordinary_damage", func(r *model.CompileRequest) {
			r.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{Operation: "heal", Target: "self", Amount: &model.GenericFormulaExpr{Op: "read", Path: "provider.elapsed_ms"}}}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := momentSlowCompileInput()
			tc.change(&r)
			if got := CompileGeneric(r); got.OK {
				t.Fatal("unsupported scope/result obtained actual elapsed context", tc.name)
			}
		})
	}
}

func statusDurationForMoment(value float64) *model.GenericFormulaExpr {
	expr := statusConst(value)
	return &expr
}

func TestCompileMomentSlowExpandsAllConditionalAndNamedDependencies(t *testing.T) {
	for _, path := range []string{"source.attr.attack_damage.resolved", "target.resource.mana.current", "ability.param.strength", "event.damage.killed", "use.charge_duration_ms", "process.actual_cost.mana", "provider.state.n"} {
		t.Run(path, func(t *testing.T) {
			r := momentSlowCompileInput()
			// The forbidden branch is not selected at application (elapsed zero).
			r.SharedProviders[1].StatusContributions[0].Strength.Args[2] = model.GenericFormulaExpr{Op: "read", Path: path}
			got := CompileGeneric(r)
			if got.OK {
				t.Fatal("unselected conditional read escaped dependency admission", path)
			}
			for _, err := range got.Result.Errors {
				if strings.Contains(err.Path, "strength") {
					return
				}
			}
			t.Fatal("missing strength use-point error", got.Result.Errors)
		})
	}
	for _, runtime := range []bool{false, true} {
		r := momentSlowCompileInput()
		read := model.GenericFormulaExpr{Op: "read", Path: "source.attr.attack_damage.resolved"}
		if runtime {
			read.Path = "ability.param.unselected"
		}
		def := formuladefinition.FromExpr("hidden", "configured_skill", model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{statusConst(0), read, statusConst(.6)}}, nil)
		r.Formulas = []model.NamedFormula{def}
		r.SharedProviders[1].StatusContributions[0].Strength = model.GenericFormulaExpr{Op: "ref", Ref: "hidden"}
		if got := CompileGeneric(r); got.OK {
			t.Fatal("shared authored unused branch hid a live read", runtime)
		}
	}
}
