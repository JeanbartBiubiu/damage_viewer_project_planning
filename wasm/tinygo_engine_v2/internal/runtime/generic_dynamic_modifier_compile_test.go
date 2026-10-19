package runtime

import (
	"testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func TestDynamicModifierCompileAdmission(t *testing.T) {
	for _, mutation := range []string{"negative", "dynamic", "percentage", "other_resource", "no_policy", "condition", "no_duration", "infinite", "many_layers", "append", "periodic", "listener", "state", "target_other", "global", "initial_mount"} {
		input, _ := resourceMaxInput(t, 500, 1500, true)
		p := &input.SharedProviders[1]
		mod := &p.Modifiers[1]
		switch mutation {
		case "negative":
			mod.Value = hitConst(-1)
		case "dynamic":
			mod.Value = model.GenericFormulaExpr{Op: "read", Path: "source.attr.hp.current"}
		case "percentage":
			mod.ValuePolicy = "percent_add"
		case "other_resource":
			mod.Target = "self.attr.mana"
		case "no_policy":
			mod.CurrentValuePolicy = ""
		case "condition":
			mod.Condition = timedShieldExpr(1)
		case "no_duration":
			p.Lifecycle = nil
		case "infinite":
			p.Lifecycle.DurationMs = timedShieldExpr(0)
		case "many_layers":
			p.Lifecycle.MaxStacks = 2
		case "append":
			p.Lifecycle.InstanceScope = ""
		case "periodic":
			p.Lifecycle.TickIntervalMs = 100
		case "listener":
			p.Listeners = []model.ListenerDefinition{{ListenerKey: "unexpected", EventMatcher: model.TypeMatcher{All: []string{"event/ability_started"}}}}
		case "state":
			p.InitialStateSchema = map[string]interface{}{"unexpected": float64(0)}
		case "target_other":
			input.SharedProviders[0].Processes[0].MomentOperations[0].Operations[0].Target = "target"
		case "global":
			input.Rules.Modifiers = []model.ModifierDefinition{*mod}
		case "initial_mount":
			input.Combatants[0].Providers = append(input.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: "active", DefinitionRef: p.ProviderKey})
		}
		result := compilebundle.CompileGeneric(input)
		if mutation == "initial_mount" {
			if !result.OK {
				continue
			}
			_, run := resourceMaxInput(t, 500, 1500, false)
			run.InitialSnapshot.Combatants[0].Providers = append(run.InitialSnapshot.Combatants[0].Providers, model.CombatantProviderSnapshot{ProviderRef: "active", DefinitionRef: p.ProviderKey, Source: "source", Owner: "source", Stacks: 1})
			if _, err := newGenericRunState(result.Session, run); err == nil {
				t.Fatal("initial mount restored")
			}
			continue
		}
		if result.OK {
			t.Fatal(mutation, "invalid resource modifier admitted")
		}
	}
	for _, mutation := range []string{"zero", "negative", "dynamic", "missing_refs", "duplicate_refs", "unknown_ref", "hit_ref", "plain_field", "other_target", "other_policy"} {
		input, _ := cooldownDurationInput(t, 7500, []string{"source.provider[caster].ability[initial]"})
		mod := &input.SharedProviders[1].Modifiers[0]
		switch mutation {
		case "zero":
			mod.Value = hitConst(0)
		case "negative":
			mod.Value = hitConst(-.5)
		case "dynamic":
			mod.Value = model.GenericFormulaExpr{Op: "read", Path: "source.attr.armor.resolved"}
		case "missing_refs":
			mod.AffectedAbilityRefs = nil
		case "duplicate_refs":
			*mod.AffectedAbilityRefs = append(*mod.AffectedAbilityRefs, (*mod.AffectedAbilityRefs)[0])
		case "unknown_ref":
			*mod.AffectedAbilityRefs = []string{"source.provider[unknown].ability[initial]"}
		case "hit_ref":
			*mod.AffectedAbilityRefs = []string{"source.provider[caster].ability[hit]"}
		case "plain_field":
			mod.CurrentValuePolicy = "grant_positive_delta_clamp"
		case "other_target":
			mod.Target = "target"
		case "other_policy":
			mod.ValuePolicy = "add"
		}
		if result := compilebundle.CompileGeneric(input); result.OK {
			t.Fatal(mutation, "invalid cooldown factor admitted")
		}
	}
}
