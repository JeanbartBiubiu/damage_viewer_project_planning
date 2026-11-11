// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	json "encoding/json"
	math "math"
	reflect "reflect"
	strings "strings"
	testing "testing"
	compile "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
)

func phase3Const(value string) map[string]any { return map[string]any{"op": "const", "value": value} }

func phase3Read(key string) map[string]any { return map[string]any{"op": "read", "inputKey": key} }

func phase3Ref(key string) map[string]any { return map[string]any{"op": "ref", "stageKey": key} }

func phase3Binary(op string, a, b any) map[string]any {
	return map[string]any{"op": op, "args": []any{a, b}}
}

func phase3Stage(key string, expr any) map[string]any {
	return map[string]any{"key": key, "name": "共同结果", "expression": expr}
}

func phase3Input(key, object, attribute, valueKind string) map[string]any {
	return map[string]any{"key": key, "binding": map[string]any{"kind": "attribute", "object": object, "attributeKey": attribute, "valueKind": valueKind, "view": "current_frame"}}
}

func phase3Definition(inputs, stages []any, output string) map[string]any {
	if inputs == nil {
		inputs = []any{}
	}
	return map[string]any{"inputs": inputs, "stages": stages, "outputStageKey": output}
}

func phase3ConstantDefinition(value string) map[string]any {
	return phase3Definition(nil, []any{phase3Stage("factor", phase3Const(value))}, "factor")
}

func phase3HeatDefinition(stages int) map[string]any {
	inputs := []any{phase3Input("defense", "target", "armor", "TOTAL")}
	if stages == 1 {
		return phase3Definition(inputs, []any{phase3Stage("factor", phase3Binary("div", phase3Const("100"), phase3Binary("add", phase3Const("100"), phase3Read("defense"))))}, "factor")
	}
	if stages == 2 {
		return phase3Definition(inputs, []any{phase3Stage("denominator", phase3Binary("add", phase3Const("100"), phase3Read("defense"))), phase3Stage("factor", phase3Binary("div", phase3Const("100"), phase3Ref("denominator")))}, "factor")
	}
	return phase3Definition(inputs, []any{
		phase3Stage("factor", phase3Ref("ratio")), phase3Stage("unused", phase3Binary("div", phase3Const("1"), phase3Const("0"))),
		phase3Stage("resistance", phase3Read("defense")), phase3Stage("denominator", phase3Binary("add", phase3Ref("resistance"), phase3Ref("hundred"))),
		phase3Stage("hundred", phase3Const("100")), phase3Stage("ratio", phase3Binary("div", phase3Ref("hundred"), phase3Ref("denominator"))),
	}, "factor")
}

// 独立输入：无通用基准样例读取或复制，也不代表真实管理数据。
func phase3HeatInput() (model.CompileRequest, model.RunRequest) {
	c := model.CompileRequest{SchemaVersion: model.GenericSchemaVersion, SchemaHash: "phase3-heat-schema", RulesHash: "phase3-heat-rules",
		TypeCatalog: model.TypeCatalog{Types: []model.TypeCatalogEntry{{Key: "heat", Domain: "damage"}, {Key: "armor", Domain: "attribute"}}},
		Combatants: []model.CombatantDefinition{
			{Key: "source", Attributes: map[string]model.AttributeSlotDef{"armor": authoringSlot(0)}, Resources: map[string]model.ResourceSlotDef{}, Providers: []model.CombatantProviderMount{{ProviderRef: "formula_heat", DefinitionRef: "formula_heat"}}},
			{Key: "target", Attributes: map[string]model.AttributeSlotDef{"hp": authoringSlot(1000), "armor": authoringSlot(50)}, Resources: map[string]model.ResourceSlotDef{}},
		},
		SharedProviders: []model.ProviderDefinition{{ProviderKey: "formula_heat", Kind: "champion", StableID: "formula_heat", Abilities: []model.AbilityDefinition{{AbilityKey: "heat_hit", Kind: "active", Operations: []model.OperationDefinition{{Operation: "damage", Target: "target", Amount: authoringAmount(authoringConst(120)), DamageType: "heat"}}}}}},
	}
	c.Rules.DamageTypeFormulas = []model.DamageTypeFormulaDefinition{{DamageType: "heat", Formula: phase3HeatDefinition(2)}}
	r := model.RunRequest{SessionID: "phase3-test", ExpectedRulesHash: c.RulesHash, InitialSnapshot: model.Snapshot{SchemaHash: c.SchemaHash, RulesHash: c.RulesHash, Combatants: []model.CombatantSnapshot{
		{Key: "source", Attributes: copyAttributeInput(c.Combatants[0].Attributes), Resources: map[string]model.ResourceSlotDef{}, Providers: []model.CombatantProviderSnapshot{{ProviderRef: "formula_heat", DefinitionRef: "formula_heat", Source: "source", Owner: "source", Stacks: 1}}},
		{Key: "target", Attributes: copyAttributeInput(c.Combatants[1].Attributes), Resources: map[string]model.ResourceSlotDef{}, Shields: []model.CombatantShieldSnapshot{{ShieldRef: "heat_shield", Source: "target", Owner: "target", Remaining: 30}}},
	}}, DriverPlan: model.DriverPlan{Entries: []model.DriverEntry{{EntryKey: "heat_once", AbilityRef: "source.provider[formula_heat].ability[heat_hit]", Source: "source", Target: "target"}}}, StopPolicy: model.StopPolicy{DurationMs: 100}, Sampling: model.SamplingConfig{SampleEveryMs: 100, DpsWindowMs: 1000, MaxSeriesPoints: 8}}
	return c, r
}

func phase3AssertNear(t *testing.T, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("got %g want %g", got, want)
	}
}

func TestFormulaPhase3HeatOneTwoSixResultsAndRenamedOriginalKeys(t *testing.T) {
	for _, stages := range []int{1, 2, 6} {
		c, r := phase3HeatInput()
		c.Rules.DamageTypeFormulas[0].Formula = phase3HeatDefinition(stages)
		if stages == 6 {
			// 展示名与原key均可更改，身份引用显式同步，顺序保持前后依赖。
			c.TypeCatalog.Types[0].Key = "renamed_heat"
			c.TypeCatalog.Types[1].Key = "original.defense/key"
			c.Rules.DamageTypeFormulas[0].DamageType = "renamed_heat"
			c.SharedProviders[0].Abilities[0].Operations[0].DamageType = "renamed_heat"
			root := c.Rules.DamageTypeFormulas[0].Formula.(map[string]any)
			root["inputs"].([]any)[0].(map[string]any)["binding"].(map[string]any)["attributeKey"] = "original.defense/key"
			for _, raw := range root["stages"].([]any) {
				raw.(map[string]any)["name"] = "任意中文名"
			}
			for i := range c.Combatants {
				c.Combatants[i].Attributes["original.defense/key"] = c.Combatants[i].Attributes["armor"]
				delete(c.Combatants[i].Attributes, "armor")
				r.InitialSnapshot.Combatants[i].Attributes = copyAttributeInput(c.Combatants[i].Attributes)
			}
		}
		done := authoringRun(t, c, r)
		phase3AssertNear(t, done.Summary.SourceDamageDealt, 80)
		phase3AssertNear(t, done.Summary.TargetFinalHp, 950)
		for _, e := range done.Evidence.Items {
			if e.Kind != model.EvidenceKindDamage {
				continue
			}
			phase3AssertNear(t, e.Data["resistanceFactor"].(float64), 2.0/3)
			phase3AssertNear(t, e.Data["shieldAbsorbed"].(float64), 30)
			phase3AssertNear(t, e.Data["actualHpLoss"].(float64), 50)
			for _, field := range []string{"resistanceBeforePenetration", "penetrationPercent", "penetrationFlat", "effectiveResistance"} {
				if _, exists := e.Data[field]; exists {
					t.Fatalf("invented old defense stage %s", field)
				}
			}
		}
	}
}

func TestFormulaPhase3OnlyTrustedAttributeCatalogAuthorizesBindings(t *testing.T) {
	for _, change := range []func(map[string]any){
		func(b map[string]any) { b["object"] = "owner" }, func(b map[string]any) { b["object"] = "event_target" },
		func(b map[string]any) { b["view"] = "event_snapshot" }, func(b map[string]any) { b["valueKind"] = "MAX" },
		func(b map[string]any) { b["attributeKey"] = "undeclared" },
	} {
		c, _ := phase3HeatInput()
		root := c.Rules.DamageTypeFormulas[0].Formula.(map[string]any)
		change(root["inputs"].([]any)[0].(map[string]any)["binding"].(map[string]any))
		result := compile.CompileGeneric(c)
		if result.OK || result.Result.Errors[0].Code != "FORMULA_UNKNOWN_BINDING" || result.Result.Errors[0].Path != "/rules/damageTypeFormulas/0/formula/inputs/0/binding" {
			t.Fatal(result.Result.Errors)
		}
	}
	c, _ := phase3HeatInput()
	c.TypeCatalog.Types = c.TypeCatalog.Types[:1]
	if result := compile.CompileGeneric(c); result.OK || result.Result.Errors[0].Code != "FORMULA_UNKNOWN_BINDING" {
		t.Fatal("author self-authorized", result.Result.Errors)
	}
}

func TestFormulaPhase3SourceTargetAndBaseBonusTotalReadScopes(t *testing.T) {
	for _, object := range []string{"source", "target"} {
		for _, valueKind := range []string{"BASE", "BONUS", "TOTAL"} {
			c, r := phase3HeatInput()
			r.InitialSnapshot.Combatants[1].Shields = nil
			c.Rules.DamageTypeFormulas[0].Formula = phase3Definition([]any{phase3Input("factor", object, "armor", valueKind)}, []any{phase3Stage("factor", phase3Read("factor"))}, "factor")
			// 两侧普通修正独立计算，不按名称换成另一侧。
			c.Combatants[0].Attributes["armor"] = authoringSlot(.5)
			r.InitialSnapshot.Combatants[0].Attributes["armor"] = authoringSlot(.5)
			c.Combatants[1].Attributes["armor"] = authoringSlot(1)
			r.InitialSnapshot.Combatants[1].Attributes["armor"] = authoringSlot(1)
			want := 120.0
			if object == "source" {
				want = 60
			}
			if valueKind == "BONUS" {
				want = 0
			}
			done := authoringRun(t, c, r)
			phase3AssertNear(t, done.Summary.SourceDamageDealt, want)
		}
	}
}

func TestFormulaPhase3JSONMissingFieldsLegalZeroAndFailureRetrySameSession(t *testing.T) {
	c, r := phase3HeatInput()
	session := authoringCompile(t, c)
	before := session.Formulas
	for _, raw := range []string{`{"base":50,"current":50,"max":50}`, `{"current":50,"max":50,"resolved":50}`} {
		var slot model.AttributeSlotDef
		if err := json.Unmarshal([]byte(raw), &slot); err != nil {
			t.Fatal(err)
		}
		bad := r
		bad.InitialSnapshot.Combatants = append([]model.CombatantSnapshot(nil), r.InitialSnapshot.Combatants...)
		bad.InitialSnapshot.Combatants[1].Attributes = copyAttributeInput(r.InitialSnapshot.Combatants[1].Attributes)
		bad.InitialSnapshot.Combatants[1].Attributes["armor"] = slot
		if strings.Contains(raw, `"base"`) {
			_, err := runtimeengine.RunGeneric(session, bad)
			if err == nil || err.Code != "FORMULA_MISSING_INPUT" || err.Path != "/rules/damageTypeFormulas/0/formula/stages/0/expression/args/1/inputKey" || err.Ref != r.DriverPlan.Entries[0].AbilityRef {
				t.Fatal(err)
			}
		} else {
			baseC, _ := phase3HeatInput()
			baseC.Rules.DamageTypeFormulas[0].Formula = phase3Definition([]any{phase3Input("base", "target", "armor", "BASE")}, []any{phase3Stage("factor", phase3Read("base"))}, "factor")
			_, err := runtimeengine.RunGeneric(authoringCompile(t, baseC), bad)
			if err == nil || err.Code != "FORMULA_MISSING_INPUT" {
				t.Fatal(err)
			}
		}
		if !reflect.DeepEqual(session.Formulas, before) {
			t.Fatal("failed run changed shared registry")
		}
	}
	for i := 0; i < 20; i++ {
		done, err := runtimeengine.RunGeneric(session, r)
		if err != nil {
			t.Fatal(err)
		}
		phase3AssertNear(t, done.Summary.TargetFinalHp, 950)
	}
	zero := r
	zero.InitialSnapshot.Combatants = append([]model.CombatantSnapshot(nil), r.InitialSnapshot.Combatants...)
	zero.InitialSnapshot.Combatants[1].Attributes = copyAttributeInput(r.InitialSnapshot.Combatants[1].Attributes)
	var slot model.AttributeSlotDef
	if err := json.Unmarshal([]byte(`{"base":0,"current":0,"max":0,"resolved":0}`), &slot); err != nil {
		t.Fatal(err)
	}
	zero.InitialSnapshot.Combatants[1].Attributes["armor"] = slot
	done, err := runtimeengine.RunGeneric(session, zero)
	if err != nil {
		t.Fatal(err)
	}
	phase3AssertNear(t, done.Summary.TargetFinalHp, 910)
}

func TestFormulaPhase3DynamicDivideZeroNegativeAndZeroFactor(t *testing.T) {
	for _, value := range []string{"-1", "0"} {
		c, r := phase3HeatInput()
		c.Rules.DamageTypeFormulas[0].Formula = phase3ConstantDefinition(value)
		done, err := runtimeengine.RunGeneric(authoringCompile(t, c), r)
		if value == "-1" {
			if err == nil || err.Code != "FORMULA_INVALID_OUTPUT" || err.Path != "/rules/damageTypeFormulas/0/formula/stages/0/expression" {
				t.Fatal(err)
			}
		} else {
			if err != nil {
				t.Fatal(err)
			}
			phase3AssertNear(t, done.Summary.TargetFinalHp, 1000)
		}
	}
	c, r := phase3HeatInput()
	r.InitialSnapshot.Combatants[1].Attributes["armor"] = authoringSlot(-100)
	_, err := runtimeengine.RunGeneric(authoringCompile(t, c), r)
	if err == nil || err.Code != "FORMULA_DIVISION_BY_ZERO" || err.Path != "/rules/damageTypeFormulas/0/formula/stages/1/expression" {
		t.Fatal(err)
	}
}

func TestFormulaPhase3NormalCriticalPartsShareDefenseFactor(t *testing.T) {
	c, r := phase3HeatInput()
	op := &c.SharedProviders[0].Abilities[0].Operations[0]
	op.CritEligible = true
	op.CritChance = authoringAmount(authoringConst(.5))
	op.CritMultiplier = authoringAmount(authoringConst(2))
	done := authoringRun(t, c, r)
	phase3AssertNear(t, done.Summary.SourceDamageDealt, 120)
	phase3AssertNear(t, done.Summary.TargetFinalHp, 910)
	for _, e := range done.Evidence.Items {
		if e.Kind != model.EvidenceKindDamage {
			continue
		}
		phase3AssertNear(t, e.Data["normalPartPostResistance"].(float64), 40)
		phase3AssertNear(t, e.Data["critPartPostResistance"].(float64), 80)
		phase3AssertNear(t, e.Data["resistanceFactor"].(float64), 2.0/3)
	}
}

func TestFormulaPhase3LegacyFiveFieldsRejectedAndCompiledProgramImmutable(t *testing.T) {
	c, r := phase3HeatInput()
	root := c.Rules.DamageTypeFormulas[0].Formula.(map[string]any)
	session := authoringCompile(t, c)
	root["stages"].([]any)[1].(map[string]any)["expression"] = phase3Const("0")
	done, err := runtimeengine.RunGeneric(session, r)
	if err != nil {
		t.Fatal(err)
	}
	phase3AssertNear(t, done.Summary.TargetFinalHp, 950)
	c.Rules.DamageTypeFormulas[0].Formula = map[string]any{"resistanceFactor": phase3Const("1")}
	result := compile.CompileGeneric(c)
	if result.OK || result.Result.Errors[0].Code != "FORMULA_INVALID_STRUCTURE" {
		t.Fatal(result.Result.Errors)
	}
}

func TestFormulaPhase3CurrentFrameDefenseUsesEntryView(t *testing.T) {
	c, r := phase3HeatInput()
	slot := c.Combatants[1].Attributes["armor"]
	slot.Max = 1000
	c.Combatants[1].Attributes["armor"] = slot
	r.InitialSnapshot.Combatants[1].Attributes["armor"] = slot
	ops := c.SharedProviders[0].Abilities[0].Operations
	c.SharedProviders[0].Abilities[0].Operations = append([]model.OperationDefinition{{Operation: "attribute_change", Target: "target", AttributeKey: "armor", ValuePolicy: "add_flat", Amount: authoringAmount(authoringConst(100))}}, ops...)
	done := authoringRun(t, c, r)
	phase3AssertNear(t, done.Summary.TargetFinalHp, 950)
	phase3AssertNear(t, done.FinalSnapshot.Combatants[1].Attributes["armor"].Resolved, 150)
}

func TestFormulaPhase3RawTypePredicateAndSameKeyAttributeMatcher(t *testing.T) {
	c, r := phase3HeatInput()
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: "heat", Domain: "attribute"})
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: "event/damage_instance", Domain: "event"})
	slot := c.Combatants[0].Attributes["armor"]
	slot.Max = 1000
	c.Combatants[0].Attributes["armor"] = slot
	r.InitialSnapshot.Combatants[0].Attributes["armor"] = slot
	c.Rules.Listeners = []model.ListenerDefinition{{ListenerKey: "scoped_heat", EventMatcher: model.TypeMatcher{All: []string{"event/damage_instance", "heat"}}, Operations: []model.OperationDefinition{{Operation: "attribute_change", Target: "source", AttributeKey: "armor", Amount: authoringAmount(authoringConst(10))}}}}
	c.SharedProviders[0].Modifiers = []model.ModifierDefinition{{ModifierKey: "raw_heat", Kind: "pipeline", Command: "damage", Channel: "all_damage", Stage: "outgoing_pre_mitigation", Bucket: "all_instances", ValuePolicy: "multiply", Value: authoringConst(2), Condition: authoringAmount(authoringRead("damage.type.heat"))}}
	done := authoringRun(t, c, r)
	phase3AssertNear(t, done.Summary.SourceDamageDealt, 160)
	phase3AssertNear(t, done.Summary.TargetFinalHp, 870)
	phase3AssertNear(t, done.FinalSnapshot.Combatants[0].Attributes["armor"].Resolved, 10)
	// 相同可读原键绑定attribute身份，伤害身份不会授权另一份属性。
	c.Rules.DamageTypeFormulas[0].Formula = phase3Definition([]any{phase3Input("same", "target", "heat", "TOTAL")}, []any{phase3Stage("factor", phase3Read("same"))}, "factor")
	r.InitialSnapshot.Combatants[1].Attributes["heat"] = authoringSlot(.5)
	done = authoringRun(t, c, r)
	phase3AssertNear(t, done.Summary.SourceDamageDealt, 120)
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: "physical", Domain: "damage"})
	c.SharedProviders[0].Modifiers[0].Condition = authoringAmount(authoringRead("damage.type.physical"))
	done = authoringRun(t, c, r)
	phase3AssertNear(t, done.Summary.SourceDamageDealt, 60)
}

func TestFormulaPhase3ExplicitBuiltinEventIgnoresAttributeSameKey(t *testing.T) {
	for _, collision := range []bool{false, true} {
		c, r := phase3HeatInput()
		c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: "event/damage_instance", Domain: "event"})
		if collision {
			c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: "event/damage_instance", Domain: "attribute"})
		}
		slot := c.Combatants[0].Attributes["armor"]
		slot.Max = 1000
		c.Combatants[0].Attributes["armor"] = slot
		r.InitialSnapshot.Combatants[0].Attributes["armor"] = slot
		c.Rules.Listeners = []model.ListenerDefinition{{ListenerKey: "builtin_collision", EventMatcher: model.TypeMatcher{All: []string{"event/damage_instance", "heat"}}, Operations: []model.OperationDefinition{{Operation: "attribute_change", Target: "source", AttributeKey: "armor", Amount: authoringAmount(authoringConst(10))}}}}
		done := authoringRun(t, c, r)
		phase3AssertNear(t, done.Summary.TargetFinalHp, 950)
		phase3AssertNear(t, done.FinalSnapshot.Combatants[0].Attributes["armor"].Resolved, 10)
		if events := emittedEventsByRef(done, "event/damage_instance"); len(events) != 1 {
			t.Fatal("builtin event suppressed", collision, events)
		}
	}
}

func TestFormulaPhase3ExplicitBasicAbilityAndCastOriginIgnoreAttributeSameKeys(t *testing.T) {
	for _, collision := range []bool{false, true} {
		c, r := phase3HeatInput()
		c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: model.AbilityTypeBasicAttack, Domain: "ability"}, model.TypeCatalogEntry{Key: "cast_origin/champion", Domain: "cast_origin"})
		if collision {
			c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: model.AbilityTypeBasicAttack, Domain: "attribute"}, model.TypeCatalogEntry{Key: "cast_origin/champion", Domain: "attribute"})
		}
		c.SharedProviders[0].Abilities[0].Types = []string{model.AbilityTypeBasicAttack}
		c.SharedProviders[0].Abilities[0].CastOrigin = "champion"
		c.SharedProviders[0].Modifiers = []model.ModifierDefinition{{ModifierKey: "basic_type_collision", Kind: "pipeline", Command: "damage", Channel: "basic_damage", Stage: "outgoing_pre_mitigation", Bucket: "all_instances", ValuePolicy: "multiply", Value: authoringConst(2), Condition: authoringAmount(authoringRead("damage.cast_origin.champion"))}}
		done := authoringRun(t, c, r)
		phase3AssertNear(t, done.Summary.TargetFinalHp, 870)
		phase3AssertNear(t, done.Summary.SourceDamageDealt, 160)
	}
}

func TestFormulaPhase3ExplicitSpellShieldProviderIgnoresAttributeSameKey(t *testing.T) {
	for _, collision := range []bool{false, true} {
		c, r := phase3HeatInput()
		c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: "ability/spell", Domain: "ability"}, model.TypeCatalogEntry{Key: model.ProviderTypeSpellShield, Domain: "provider"}, model.TypeCatalogEntry{Key: model.EventTypeSkillHit, Domain: "event"}, model.TypeCatalogEntry{Key: model.EventTypeSpellShieldBlocked, Domain: "event"})
		if collision {
			c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: model.ProviderTypeSpellShield, Domain: "attribute"}, model.TypeCatalogEntry{Key: model.EventTypeSpellShieldBlocked, Domain: "attribute"}, model.TypeCatalogEntry{Key: "ability/spell", Domain: "attribute"})
		}
		candidate := damageCand("heat", "heat_effect", "heat_result", model.SpellShieldScopeSkill, 0)
		candidate.Operations[0].DamageType = "heat"
		candidate.Operations[0].Amount = authoringAmount(authoringConst(120))
		ability := &c.SharedProviders[0].Abilities[0]
		ability.SkillKey = "phase3_spell"
		ability.Types = []string{"ability/spell"}
		ability.Operations = []model.OperationDefinition{{Operation: model.OperationKindResolveSkillHit, Target: "target", SkillHit: &model.SkillHitDefinition{SkillKey: "phase3_spell", Candidates: []model.SkillHitCandidate{candidate}}}}
		c.SharedProviders = append(c.SharedProviders, spellShieldProvider())
		c.Combatants[1].Providers = []model.CombatantProviderMount{{ProviderRef: "spell_shield", DefinitionRef: "shield:spell"}}
		expires := int64(5000)
		r.InitialSnapshot.Combatants[1].Providers = []model.CombatantProviderSnapshot{{ProviderRef: "spell_shield", DefinitionRef: "shield:spell", Source: "target", Owner: "target", Stacks: 1, ExpireAt: &expires}}
		r.SkillUses = []model.SkillUseFact{{UseKey: "phase3_use", Source: "source", SkillKey: "phase3_spell", HistoryState: model.SkillHitHistoryComplete}}
		r.SkillHitFacts = []model.SkillHitFact{{DriverEntryKey: "heat_once", UseRef: hitUse("phase3_use")}}
		done := authoringRun(t, c, r)
		phase3AssertNear(t, done.Summary.TargetFinalHp, 1000)
		phase3AssertNear(t, done.Summary.SourceDamageDealt, 0)
		if len(done.FinalSnapshot.Combatants[1].Providers) != 0 {
			t.Fatal("real spell shield was not consumed", collision, done.FinalSnapshot.Combatants[1].Providers)
		}
		if events := emittedEventsByRef(done, model.EventTypeSpellShieldBlocked); len(events) != 1 {
			t.Fatal("block event missing", collision, events)
		}
	}
}
