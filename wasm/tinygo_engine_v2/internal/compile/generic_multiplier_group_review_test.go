package compile

import (
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestCompileGroupedReviewLinkedShieldRejectsGroupOnly(t *testing.T) {
	for _, grouped := range []bool{false, true} {
		t.Run(map[bool]string{false: "existing_static_attribute", true: "grouped_attribute"}[grouped], func(t *testing.T) {
			req := linkedShieldCompileInput()
			req.SharedProviders[1].Kind = "status"
			mod := multiplierTestAttribute("gain", "self.attr.attack_damage", "", 1.2)
			if grouped {
				mod.MultiplierGroupKey = multiplierTestKey("gain")
			}
			req.SharedProviders[1].Modifiers = []model.ModifierDefinition{mod}
			if grouped {
				requireMultiplierFailure(t, req, "sharedProviders[1]")
				return
			}
			result := CompileGeneric(req)
			if !result.OK || !result.Session.Providers[1].AtomicLinkedShield {
				t.Fatalf("complete existing linked shield graph was rejected: %+v", result.Result.Errors)
			}
		})
	}
}

func TestCompileGroupedReviewRuleAttributeRequiresRolePath(t *testing.T) {
	for _, target := range []string{"power", "attack_damage"} {
		t.Run(target, func(t *testing.T) {
			req := minimalValidCompileRequest()
			req.Rules.Modifiers = []model.ModifierDefinition{multiplierTestAttribute("gain", target, "gain", 1.2)}
			requireMultiplierFailure(t, req, "rules.modifiers[0].target")
		})
	}
	for _, target := range []string{"source.attr.attack_damage", "target.attr.attack_damage", "self.attr.attack_damage", "opponent.attr.attack_damage"} {
		t.Run(target, func(t *testing.T) {
			req := minimalValidCompileRequest()
			req.Rules.Modifiers = []model.ModifierDefinition{multiplierTestAttribute("gain", target, "gain", 1.2)}
			result := CompileGeneric(req)
			if !result.OK || !result.Session.RuleModifiers[0].HasMultiplierGroup {
				t.Fatal("explicit rule attribute target was rejected", result.Result.Errors)
			}
		})
	}
	for _, provider := range []bool{false, true} {
		req := minimalValidCompileRequest()
		mod := multiplierTestAttribute("gain", "attack_damage", "", 1.2)
		if provider {
			mod.MultiplierGroupKey = multiplierTestKey("gain")
			req.SharedProviders[0].Modifiers = []model.ModifierDefinition{mod}
		} else {
			req.Rules.Modifiers = []model.ModifierDefinition{mod}
		}
		if result := CompileGeneric(req); !result.OK {
			t.Fatal("provider-relative group or existing ungrouped rule changed", provider, result.Result.Errors)
		}
	}
}

func TestCompileGroupedReviewStaticFalseDoesNotEnterOverflow(t *testing.T) {
	for _, scenario := range []string{"different_group", "same_group", "first_group_false", "only_group_false"} {
		t.Run(scenario, func(t *testing.T) {
			req := minimalValidCompileRequest()
			a, b := multiplierTestDamage("a", "gain", 1e308), multiplierTestDamage("b", "other", 2)
			b.Condition = finiteExprPtr(constN(0))
			switch scenario {
			case "same_group":
				b = multiplierTestDamage("b", "gain", 1e308)
				b.Condition = finiteExprPtr(constN(0))
			case "first_group_false":
				a.Condition, b.Condition = finiteExprPtr(constN(0)), nil
			case "only_group_false":
				a.Condition = finiteExprPtr(constN(0))
			}
			req.SharedProviders[0].Modifiers = []model.ModifierDefinition{a, b}
			if result := CompileGeneric(req); !result.OK {
				t.Fatal("statically inactive grouped member entered overflow product", result.Result.Errors)
			}
		})
	}
}

func TestCompileGroupedReviewStaticFalseKeepsMemberAndBandValidation(t *testing.T) {
	for _, condition := range []model.GenericFormulaExpr{constN(1), {Op: "read", Path: "source.attr.attack_damage.resolved"}} {
		req := minimalValidCompileRequest()
		a, b := multiplierTestDamage("a", "gain", 1e308), multiplierTestDamage("b", "other", 2)
		b.Condition = finiteExprPtr(condition)
		req.SharedProviders[0].Modifiers = []model.ModifierDefinition{a, b}
		requireMultiplierFailure(t, req, ".value")
	}
	invalid := minimalValidCompileRequest()
	bad := multiplierTestDamage("invalid", "gain", .8)
	bad.Condition = finiteExprPtr(constN(0))
	invalid.SharedProviders[0].Modifiers = []model.ModifierDefinition{bad}
	requireMultiplierFailure(t, invalid, ".value")

	dependency := minimalValidCompileRequest()
	bad = multiplierTestDamage("hidden_amount", "gain", 1.2)
	bad.Value = compileIfExpr(constN(0), model.GenericFormulaExpr{Op: "read", Path: "damage.amount"}, constN(1.2))
	bad.Condition = finiteExprPtr(constN(0))
	dependency.SharedProviders[0].Modifiers = []model.ModifierDefinition{bad}
	requireMultiplierFailure(t, dependency, ".value")
}

func TestCompileGroupedReviewFalseIndependentDoesNotHideOverflow(t *testing.T) {
	for _, falseFirst := range []bool{false, true} {
		req := minimalValidCompileRequest()
		inactive := multiplierTestDamage("inactive", "", .5)
		inactive.Condition = finiteExprPtr(constN(0))
		independent := multiplierTestDamage("independent", "", 2)
		mods := []model.ModifierDefinition{multiplierTestDamage("group", "gain", 1e308), independent, inactive}
		if falseFirst {
			mods[1], mods[2] = mods[2], mods[1]
		}
		req.SharedProviders[0].Modifiers = mods
		requireMultiplierFailure(t, req, ".value")
	}
}
