package compile

import (
	"testing"
	"tinygo_engine_v2/internal/plan"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

func elapsedCompileInput() model.CompileRequest {
	r := minimalValidCompileRequest()
	r.SharedProviders = append(r.SharedProviders, model.ProviderDefinition{ProviderKey: "configured_decay", StableID: "configured_decay", Kind: "buff", Lifecycle: sourceTargetLifecycle(1500),
		Modifiers: []model.ModifierDefinition{{ModifierKey: "decay", Kind: "attribute", Target: "self.attr.attack_damage", ValuePolicy: "add", Value: model.GenericFormulaExpr{Op: "read", Path: "provider.elapsed_ms"}}}})
	return r
}

func TestCompileProviderElapsedIsRestrictedToFiniteModifier(t *testing.T) {
	r := elapsedCompileInput()
	result := CompileGeneric(r)
	if !result.OK || !result.Session.Features.Has(plan.FeatureProviderElapsedReads) || !result.Session.Providers[1].NeedsElapsedTime {
		t.Fatal(result.Result.Errors)
	}
	program := result.Session.Providers[1].Modifiers[0].ValueProgram
	if _, supported := result.Session.Formulas.Metadata.AttributeCacheDependencies(program); supported {
		t.Fatal("time-dependent attribute formula must not reuse a timeless memo")
	}
	if _, err := result.Session.Formulas.Evaluation.Eval(program, formula.GenericEvalContext{}); err == nil {
		t.Fatal("elapsed read without actual provider context returned zero")
	}
}

func TestCompileProviderElapsedRejectsOtherUses(t *testing.T) {
	cases := []struct {
		name   string
		change func(*model.CompileRequest)
	}{
		{"persistent", func(r *model.CompileRequest) { r.SharedProviders[1].Lifecycle = nil }},
		{"duration", func(r *model.CompileRequest) {
			r.SharedProviders[1].Lifecycle.DurationMs = &model.GenericFormulaExpr{Op: "read", Path: "provider.elapsed_ms"}
		}},
		{"operation", func(r *model.CompileRequest) {
			r.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{Operation: "heal", Target: "self", Amount: &model.GenericFormulaExpr{Op: "read", Path: "provider.elapsed_ms"}}}
		}},
		{"stacking", func(r *model.CompileRequest) { r.SharedProviders[1].Lifecycle.MaxStacks = float64(2) }},
		{"extend", func(r *model.CompileRequest) { r.SharedProviders[1].Lifecycle.RefreshPolicy = "extend" }},
		{"implicit_append_scope", func(r *model.CompileRequest) { r.SharedProviders[1].Lifecycle.InstanceScope = "" }},
		{"initial_mount", func(r *model.CompileRequest) {
			r.Combatants[0].Providers = append(r.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: "unapplied", DefinitionRef: "configured_decay"})
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := elapsedCompileInput()
			tc.change(&r)
			result := CompileGeneric(r)
			if result.OK {
				t.Fatal("unsupported elapsed-time use compiled")
			}
		})
	}
}
