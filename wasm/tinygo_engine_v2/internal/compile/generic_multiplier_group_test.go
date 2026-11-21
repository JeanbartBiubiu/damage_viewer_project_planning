package compile

import (
	"math"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

func multiplierTestKey(key string) *string { return &key }
func multiplierTestDamage(key, group string, value float64) model.ModifierDefinition {
	m := model.ModifierDefinition{ModifierKey: key, Kind: "pipeline", Command: "damage", Stage: "outgoing_pre_mitigation", Channel: "all_damage", Bucket: "all_instances", ValuePolicy: "multiply", Value: constN(value)}
	if group != "" {
		m.MultiplierGroupKey = multiplierTestKey(group)
	}
	return m
}
func multiplierTestAttribute(key, target, group string, value float64) model.ModifierDefinition {
	m := model.ModifierDefinition{ModifierKey: key, Kind: "attribute", Target: target, Stage: "total", ValuePolicy: "multiply", Value: constN(value)}
	if group != "" {
		m.MultiplierGroupKey = multiplierTestKey(group)
	}
	return m
}
func requireMultiplierFailure(t *testing.T, req model.CompileRequest, field string) {
	t.Helper()
	result := CompileGeneric(req)
	if result.OK || !hasErrorPath(result.Result.Errors, field) {
		t.Fatalf("expected rejection at %s, got %+v", field, result.Result.Errors)
	}
}

func TestCompileMultiplierGroupZeroIsValidAndIndependentIsDistinct(t *testing.T) {
	req := minimalValidCompileRequest()
	req.SharedProviders[0].Modifiers = []model.ModifierDefinition{multiplierTestDamage("independent", "", .8), multiplierTestDamage("first", "shared_gain", 1.2), multiplierTestDamage("second", "shared_gain", 1.3), multiplierTestDamage("other", "another_gain", 1)}
	for repeat := 0; repeat < 2; repeat++ {
		result := CompileGeneric(req)
		if !result.OK {
			t.Fatal(result.Result.Errors)
		}
		mods := result.Session.Providers[0].Modifiers
		if result.Session.MultiplierGroupCount != 2 || mods[0].HasMultiplierGroup || !mods[1].HasMultiplierGroup || mods[1].MultiplierGroupID != 0 || mods[2].MultiplierGroupID != 0 || !mods[3].HasMultiplierGroup || mods[3].MultiplierGroupID != 1 {
			t.Fatal(result.Session.MultiplierGroupCount, mods)
		}
	}
}

func TestCompileMultiplierGroupKeyShape(t *testing.T) {
	for _, key := range []string{"", "Upper", "1first", "under-score", "has space", "中文", strings.Repeat("a", 65), "a\x00b"} {
		t.Run(key, func(t *testing.T) {
			req := minimalValidCompileRequest()
			mod := multiplierTestDamage("gain", "unused", 1.2)
			mod.MultiplierGroupKey = &key
			req.SharedProviders[0].Modifiers = []model.ModifierDefinition{mod}
			requireMultiplierFailure(t, req, ".multiplierGroupKey")
		})
	}
	for _, key := range []string{"a", "a_0", strings.Repeat("a", 64)} {
		req := minimalValidCompileRequest()
		req.SharedProviders[0].Modifiers = []model.ModifierDefinition{multiplierTestDamage("gain", key, 1)}
		if result := CompileGeneric(req); !result.OK {
			t.Fatal(key, result.Result.Errors)
		}
	}
}

func TestCompileMultiplierGroupCapacityCheckedBeforeNarrowing(t *testing.T) {
	ctx := &genericCompileContext{session: &plan.CompiledSession{MultiplierGroupCount: multiplierGroupCapacity - 1}, collector: newGenericCollector("schema", "rules")}
	id, ok := ctx.internMultiplierGroup("last", "group", "last")
	if !ok || id != math.MaxUint16 || ctx.session.MultiplierGroupCount != multiplierGroupCapacity {
		t.Fatal(id, ok, ctx.session.MultiplierGroupCount)
	}
	if id, ok := ctx.internMultiplierGroup("last", "group", "last"); !ok || id != math.MaxUint16 {
		t.Fatal("existing last id was rejected", id, ok)
	}
	if _, ok := ctx.internMultiplierGroup("overflow", "group", "overflow"); ok || len(ctx.multiplierGroups) != 1 || len(ctx.collector.errors) != 1 || ctx.session.MultiplierGroupCount != multiplierGroupCapacity {
		t.Fatal("capacity wrapped or consumed an id", ctx)
	}
}

func TestCompileMultiplierGroupStaticAmplificationOnly(t *testing.T) {
	for _, value := range []float64{.8, 0, -1, math.NaN(), math.Inf(1), math.Inf(-1)} {
		req := minimalValidCompileRequest()
		req.SharedProviders[0].Modifiers = []model.ModifierDefinition{multiplierTestDamage("gain", "gain", value)}
		requireMultiplierFailure(t, req, ".value")
	}
	req := minimalValidCompileRequest()
	mod := multiplierTestDamage("overflow", "gain", 1)
	mod.Value = model.GenericFormulaExpr{Op: "mul", Args: []model.GenericFormulaExpr{constN(1e308), constN(2)}}
	req.SharedProviders[0].Modifiers = []model.ModifierDefinition{mod}
	requireMultiplierFailure(t, req, ".value")
}

func TestCompileMultiplierGroupRejectsOtherClosedMechanisms(t *testing.T) {
	for name, mutate := range map[string]func(*model.ModifierDefinition){
		"add":                 func(m *model.ModifierDefinition) { m.ValuePolicy = "add" },
		"percent":             func(m *model.ModifierDefinition) { m.ValuePolicy = "percent_add" },
		"attribute_condition": func(m *model.ModifierDefinition) { m.Condition = finiteExprPtr(constN(0)) },
		"snapshot":            func(m *model.ModifierDefinition) { m.ValueReadMode = "APPLICATION_SNAPSHOT" },
		"resource": func(m *model.ModifierDefinition) {
			m.Kind = "resource_max"
			m.Stage = ""
			m.Target = "self.attr.hp"
			m.ValuePolicy = "add"
			m.CurrentValuePolicy = "preserve_initial_current"
		},
		"cooldown": func(m *model.ModifierDefinition) {
			m.Kind = "cooldown_duration"
			m.Stage = ""
			m.Target = "self"
			refs := []string{}
			m.AffectedAbilityRefs = &refs
		},
		"crit": func(m *model.ModifierDefinition) {
			*m = multiplierTestDamage("crit", "gain", 1.2)
			m.Command = "crit"
			m.Stage = "crit_chance_pre_settlement"
		},
		"crit_part": func(m *model.ModifierDefinition) {
			*m = multiplierTestDamage("crit_part", "gain", 1.2)
			m.Stage = "incoming_crit_part_post_mitigation"
		},
		"capped_flat": func(m *model.ModifierDefinition) {
			*m = multiplierTestDamage("capped", "gain", 1.2)
			m.Stage = "incoming_pre_mitigation"
			cap := .2
			m.MaximumReductionRatio = &cap
			m.ValuePolicy = "subtract"
			m.Condition = finiteExprPtr(constN(1))
		},
		"heal":              func(m *model.ModifierDefinition) { *m = multiplierTestDamage("heal", "gain", 1.2); m.Command = "heal" },
		"missing_attribute": func(m *model.ModifierDefinition) { m.Target = "" },
	} {
		t.Run(name, func(t *testing.T) {
			req := minimalValidCompileRequest()
			mod := multiplierTestAttribute("gain", "self.attr.attack_damage", "gain", 1.2)
			mutate(&mod)
			req.SharedProviders[0].Modifiers = []model.ModifierDefinition{mod}
			requireMultiplierFailure(t, req, "multiplierGroupKey")
		})
	}
}

func TestCompileDamageGroupRequiresSamePriorityChannelAndBucket(t *testing.T) {
	for name, mutate := range map[string]func(*model.ModifierDefinition){"priority": func(m *model.ModifierDefinition) { m.Priority = 1 }, "channel": func(m *model.ModifierDefinition) { m.Channel = "basic_damage" }, "bucket": func(m *model.ModifierDefinition) { m.Bucket = "first_per_cast" }} {
		t.Run(name, func(t *testing.T) {
			req := minimalValidCompileRequest()
			a, b := multiplierTestDamage("a", "gain", 1.2), multiplierTestDamage("b", "gain", 1.3)
			mutate(&b)
			req.SharedProviders[0].Modifiers = []model.ModifierDefinition{a, b}
			requireMultiplierFailure(t, req, "multiplierGroupKey")
		})
	}
}

func TestCompileDamageGroupStageIsSeparateAndOtherPriorityBandIsOrdered(t *testing.T) {
	req := minimalValidCompileRequest()
	a, b, c := multiplierTestDamage("a", "gain", 1.2), multiplierTestDamage("b", "gain", 1.3), multiplierTestDamage("before", "", 10)
	b.Stage = "incoming_post_mitigation"
	b.Priority = 5
	b.Channel = "basic_damage"
	b.Bucket = "first_per_cast"
	c.Priority = -10
	c.ValuePolicy = "subtract"
	req.SharedProviders[0].Modifiers = []model.ModifierDefinition{a, b, c}
	if result := CompileGeneric(req); !result.OK {
		t.Fatal(result.Result.Errors)
	}
}

func TestCompileGroupedDamageBandRejectsMixedPoliciesAndHiddenAmountEvenWhenFalse(t *testing.T) {
	for _, policy := range []string{"override", "subtract"} {
		req := minimalValidCompileRequest()
		a, b := multiplierTestDamage("group", "gain", 1.2), multiplierTestDamage("mixed", "", 1.3)
		b.ValuePolicy = policy
		b.Condition = finiteExprPtr(constN(0))
		req.SharedProviders[0].Modifiers = []model.ModifierDefinition{a, b}
		requireMultiplierFailure(t, req, ".valuePolicy")
	}
	for _, field := range []string{"group_value", "neighbor_value", "neighbor_condition"} {
		t.Run(field, func(t *testing.T) {
			req := minimalValidCompileRequest()
			a, b := multiplierTestDamage("group", "gain", 1.2), multiplierTestDamage("mixed", "", 1.3)
			hidden := compileIfExpr(constN(0), model.GenericFormulaExpr{Op: "read", Path: "damage.amount"}, constN(1))
			suffix := ".value"
			switch field {
			case "group_value":
				a.Value = hidden
				a.Condition = finiteExprPtr(constN(0))
			case "neighbor_value":
				b.Value = hidden
				b.Condition = finiteExprPtr(constN(0))
			case "neighbor_condition":
				b.Condition = &hidden
				suffix = ".condition"
			}
			req.SharedProviders[0].Modifiers = []model.ModifierDefinition{a, b}
			requireMultiplierFailure(t, req, suffix)
		})
	}
}

func TestCompileGroupedDamageDependencyWalkTraversesNamedRefs(t *testing.T) {
	for _, condition := range []bool{false, true} {
		ctx := &genericCompileContext{collector: newGenericCollector("s", "r"), session: &plan.CompiledSession{MultiplierGroupCount: 1}}
		ctx.formulas = fixtureFormulaBuilder([]formula.GenericProgram{{Key: "deep", Instr: []formula.GenericInstr{{Op: formula.GenericOpRead, ReadKind: formula.ReadDamageAmount}}}, {Key: "outer", Instr: []formula.GenericInstr{{Op: formula.GenericOpRef, RefIndex: 0}}}, {Key: "one", Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 1.2}}}})
		a := plan.CompiledModifier{ModifierKey: "group", Kind: "pipeline", Command: "damage", Stage: "outgoing_pre_mitigation", Channel: "all_damage", Bucket: "all_instances", ValuePolicy: "multiply", HasMultiplierGroup: true, HasValue: true, ValueProgram: 2}
		b := a
		b.ModifierKey = "neighbor"
		b.HasMultiplierGroup = false
		if condition {
			b.HasCondition = true
			b.ConditionProg = 1
		} else {
			b.ValueProgram = 1
		}
		ctx.session.Providers = []plan.CompiledProvider{{Modifiers: []plan.CompiledModifier{a, b}}}
		finalizeMultiplierGroups(ctx)
		found := false
		for _, issue := range ctx.collector.errors {
			found = found || strings.Contains(issue.Message, "damage.amount")
		}
		if !found {
			t.Fatal("transitive named dependency escaped band check", condition, ctx.collector.errors)
		}
	}
}

func TestCompileProviderInitialRoleDoesNotProveDamageGroupIsolation(t *testing.T) {
	req := minimalValidCompileRequest()
	req.SharedProviders[0].Modifiers = []model.ModifierDefinition{multiplierTestDamage("a", "gain", 1.2)}
	b := multiplierTestDamage("b", "gain", 1.3)
	b.Priority = 1
	req.SharedProviders = append(req.SharedProviders, model.ProviderDefinition{ProviderKey: "other", Kind: "status", StableID: "other", Modifiers: []model.ModifierDefinition{b}})
	req.Combatants[1].Providers = []model.CombatantProviderMount{{ProviderRef: "other", DefinitionRef: "other"}}
	requireMultiplierFailure(t, req, "multiplierGroupKey")
}

func TestCompileAbsoluteAttributeRolesAndDifferentAttributesDoNotMerge(t *testing.T) {
	for _, target := range []string{"target.attr.attack_damage", "source.attr.armor"} {
		req := minimalValidCompileRequest()
		req.SharedProviders[0].Modifiers = []model.ModifierDefinition{multiplierTestAttribute("a", "source.attr.attack_damage", "gain", 1e308), multiplierTestAttribute("b", target, "other", 1e308)}
		if result := CompileGeneric(req); !result.OK {
			t.Fatal("different actual settlements merged", target, result.Result.Errors)
		}
	}
}

func TestCompileAttributeGroupRetainsBucketMeaning(t *testing.T) {
	req := minimalValidCompileRequest()
	a, b := multiplierTestAttribute("a", "self.attr.attack_damage", "gain", 1.2), multiplierTestAttribute("b", "self.attr.attack_damage", "gain", 1.3)
	a.Bucket, b.Bucket = "unchanged", "other_order_bucket"
	req.SharedProviders[0].Modifiers = []model.ModifierDefinition{a, b}
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatal(result.Result.Errors)
	}
	mods := result.Session.Providers[0].Modifiers
	if mods[0].Bucket != a.Bucket || mods[1].Bucket != b.Bucket || !mods[0].HasMultiplierGroup || mods[0].MultiplierGroupID != mods[1].MultiplierGroupID {
		t.Fatal("attribute buckets were overwritten, grouped or rejected as damage-only vocabulary", mods)
	}
}

func TestCompileStaticGroupSumAndProductOverflow(t *testing.T) {
	for _, kind := range []string{"attribute", "damage"} {
		for _, sameGroup := range []bool{false, true} {
			req := minimalValidCompileRequest()
			key := "other"
			if sameGroup {
				key = "gain"
			}
			a, b := multiplierTestDamage("a", "gain", 1e308), multiplierTestDamage("b", key, 1e308)
			if kind == "attribute" {
				a = multiplierTestAttribute("a", "self.attr.attack_damage", "gain", 1e308)
				b = multiplierTestAttribute("b", "self.attr.attack_damage", key, 1e308)
			}
			req.SharedProviders[0].Modifiers = []model.ModifierDefinition{a, b}
			requireMultiplierFailure(t, req, ".value")
		}
	}
}

func TestCompileStaticGroupedAndIndependentMultiplierOverflow(t *testing.T) {
	for _, kind := range []string{"attribute", "damage"} {
		t.Run(kind, func(t *testing.T) {
			req := minimalValidCompileRequest()
			a, b := multiplierTestDamage("group", "gain", 1e308), multiplierTestDamage("independent", "", 2)
			if kind == "attribute" {
				a, b = multiplierTestAttribute("group", "self.attr.attack_damage", "gain", 1e308), multiplierTestAttribute("independent", "self.attr.attack_damage", "", 2)
			}
			req.SharedProviders[0].Modifiers = []model.ModifierDefinition{a, b}
			requireMultiplierFailure(t, req, ".value")
		})
	}
}

func TestCompileStaticIndependentMultiplierKeepsScopeAndExistingPolicies(t *testing.T) {
	// 独立项先乘成0.5，不能因先把组乘2临时溢出而拒绝：1e308*(2*.25)=5e307。
	shrinking := minimalValidCompileRequest()
	shrinking.SharedProviders[0].Modifiers = []model.ModifierDefinition{multiplierTestDamage("group", "gain", 1e308), multiplierTestDamage("independent", "", 2), multiplierTestDamage("reduction", "", .25)}
	if result := CompileGeneric(shrinking); !result.OK {
		t.Fatal("independent reduction was reordered after group application", result.Result.Errors)
	}
	// 独立项按现有顺序可先下溢为0，再乘大数仍为0；不能用归一化的完整实数乘积替代。
	underflow := minimalValidCompileRequest()
	underflow.SharedProviders[0].Modifiers = []model.ModifierDefinition{
		multiplierTestAttribute("group", "self.attr.attack_damage", "gain", 1e308),
		multiplierTestAttribute("a_small", "self.attr.attack_damage", "", 1e-300),
		multiplierTestAttribute("b_small", "self.attr.attack_damage", "", 1e-300),
		multiplierTestAttribute("c_large", "self.attr.attack_damage", "", 1e308),
		multiplierTestAttribute("d_large", "self.attr.attack_damage", "", 1e308),
		multiplierTestAttribute("e_large", "self.attr.attack_damage", "", 1e308),
	}
	if result := CompileGeneric(underflow); !result.OK {
		t.Fatal("existing underflow-to-zero path was replaced by normalized multiplication", result.Result.Errors)
	}
	for _, kind := range []string{"attribute", "damage"} {
		for _, value := range []float64{0, -1, .8} {
			req := minimalValidCompileRequest()
			a, b := multiplierTestDamage("group", "gain", 1e308), multiplierTestDamage("independent", "", value)
			if kind == "attribute" {
				a, b = multiplierTestAttribute("group", "self.attr.attack_damage", "gain", 1e308), multiplierTestAttribute("independent", "self.attr.attack_damage", "", value)
			}
			req.SharedProviders[0].Modifiers = []model.ModifierDefinition{a, b}
			if result := CompileGeneric(req); !result.OK {
				t.Fatal("independent multiplier was treated as a grouped amplification", kind, value, result.Result.Errors)
			}
		}
	}
	for _, kind := range []string{"attribute", "damage"} {
		req := minimalValidCompileRequest()
		a, b := multiplierTestDamage("a", "", 1e308), multiplierTestDamage("b", "", 2)
		if kind == "attribute" {
			a, b = multiplierTestAttribute("a", "self.attr.attack_damage", "", 1e308), multiplierTestAttribute("b", "self.attr.attack_damage", "", 2)
		}
		req.SharedProviders[0].Modifiers = []model.ModifierDefinition{a, b}
		if result := CompileGeneric(req); !result.OK || result.Session.MultiplierGroupCount != 0 {
			t.Fatal("ungrouped compile path gained a new static rejection", kind, result.Result.Errors)
		}
	}
	for _, scope := range []string{"other_priority", "other_stage", "other_actor", "other_attribute", "base_multiply", "false_condition", "dynamic_multiplier"} {
		t.Run(scope, func(t *testing.T) {
			req := minimalValidCompileRequest()
			a, b := multiplierTestDamage("group", "gain", 1e308), multiplierTestDamage("independent", "", 2)
			switch scope {
			case "other_priority":
				b.Priority = 1
			case "other_stage":
				b.Stage = "incoming_post_mitigation"
			case "other_actor":
				a, b = multiplierTestAttribute("group", "source.attr.attack_damage", "gain", 1e308), multiplierTestAttribute("independent", "target.attr.attack_damage", "", 2)
			case "other_attribute":
				a, b = multiplierTestAttribute("group", "self.attr.attack_damage", "gain", 1e308), multiplierTestAttribute("independent", "self.attr.armor", "", 2)
			case "base_multiply":
				a, b = multiplierTestAttribute("group", "self.attr.attack_damage", "gain", 1e308), multiplierTestAttribute("independent", "self.attr.attack_damage", "", 2)
				b.Stage = ""
			case "false_condition":
				b.Condition = finiteExprPtr(constN(0))
			case "dynamic_multiplier":
				b.Value = model.GenericFormulaExpr{Op: "read", Path: "source.attr.attack_damage.resolved"}
			}
			req.SharedProviders[0].Modifiers = []model.ModifierDefinition{a, b}
			if result := CompileGeneric(req); !result.OK {
				t.Fatal("unproven or separate multiplier entered static product", scope, result.Result.Errors)
			}
		})
	}
}

func TestCompileGroupedFiniteDamageHasExactExpiryAndIndependentPathIsUnchanged(t *testing.T) {
	for _, group := range []string{"gain", ""} {
		req := minimalValidCompileRequest()
		duration := constN(1000)
		req.SharedProviders = append(req.SharedProviders, model.ProviderDefinition{ProviderKey: "finite_damage", Kind: "status", StableID: "finite_damage", Lifecycle: &model.ProviderLifecycle{DurationMs: &duration, MaxStacks: 1, RefreshPolicy: model.RefreshPolicyReplace}, Modifiers: []model.ModifierDefinition{multiplierTestDamage("gain", group, 1.2)}})
		result := CompileGeneric(req)
		if !result.OK {
			t.Fatal(result.Result.Errors)
		}
		want := group != ""
		if result.Session.Providers[1].NeedsModifierExpiry != want || result.Session.Features.Has(plan.FeatureFiniteModifierExpiry) != want {
			t.Fatal(group, result.Session.Providers[1].NeedsModifierExpiry, result.Session.Features.Has(plan.FeatureFiniteModifierExpiry))
		}
	}
}

func TestCompileSkillHitFiniteTargetAmplificationOnlyWithGroup(t *testing.T) {
	for _, value := range []float64{.8, 1, 1.3} {
		for _, grouped := range []bool{false, true} {
			req := minimalValidCompileRequest()
			skillHitTypes(&req)
			p := finiteHitAttributeProvider("finite_gain")
			p.Modifiers[0] = multiplierTestAttribute("gain", "self.attr.attack_damage", "", value)
			if grouped {
				p.Modifiers[0].MultiplierGroupKey = multiplierTestKey("gain")
			}
			req.SharedProviders[0].Abilities = []model.AbilityDefinition{hitAbility(finiteHitAttributeCandidate(p.ProviderKey))}
			req.SharedProviders = append(req.SharedProviders, p)
			result := CompileGeneric(req)
			want := value >= 0 && value <= 1
			if grouped {
				want = value >= 1
			}
			if result.OK != want {
				t.Fatal(value, grouped, result.Result.Errors)
			}
		}
	}
}
