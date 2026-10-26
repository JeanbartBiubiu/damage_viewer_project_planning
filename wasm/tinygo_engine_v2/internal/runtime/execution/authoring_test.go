package execution

import (
	testing "testing"
	compile "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

// 独立构造通用机制数据，不读取或复制通用基准样例，也不代表真实管理数据验收。
func authoringConst(v float64) model.GenericFormulaExpr {
	return model.GenericFormulaExpr{Op: "const", Value: model.Float64Ptr(v)}
}

func authoringRead(path string) model.GenericFormulaExpr {
	return model.GenericFormulaExpr{Op: "read", Path: path}
}

func authoringBinary(op string, a, b model.GenericFormulaExpr) model.GenericFormulaExpr {
	return model.GenericFormulaExpr{Op: op, Args: []model.GenericFormulaExpr{a, b}}
}

func authoringAmount(expr model.GenericFormulaExpr) *model.GenericFormulaExpr { return &expr }

func authoringSlot(v float64) model.AttributeSlotDef {
	return model.AttributeSlotDef{Base: v, Current: v, Max: v, Resolved: v}
}

func authoringRef(key string) string { return "source.provider[attack].ability[" + key + "]" }

func authoringInput() (model.CompileRequest, model.RunRequest) {
	damage := model.OperationDefinition{CritMultiplierMin: model.Float64Ptr(1), Operation: "damage", Target: "target", Ref: "body", Amount: authoringAmount(authoringRead("source.attr.attack_damage.resolved")), DamageType: "damage/physics", CritEligible: true,
		CritChance:     authoringAmount(authoringRead("source.attr.critical_strike_chance.resolved")),
		CritMultiplier: authoringAmount(model.GenericFormulaExpr{Op: "ref", Ref: "test/critical_multiplier"})}
	link := model.OperationDefinition{Operation: model.OperationKindApplyHitLink, Target: "target", Ref: "hit_link", Amount: authoringAmount(authoringConst(1))}
	candidate := func(key, result string, op model.OperationDefinition) model.SkillHitCandidate {
		return model.SkillHitCandidate{CandidateKey: key, EffectOccurrenceKey: "attack_hit", EffectKey: "body_effect", ResultKey: key,
			Semantic: model.SkillHitSemantic{ResultType: result, Target: model.SkillHitTargetTARGET, Moment: model.SkillHitMomentInstant}, Operations: []model.OperationDefinition{op}}
	}
	process := model.ProcessDefinition{ProcessKey: "attack", SkillKey: "test_attack", Steps: []model.ProcessStepDefinition{{StepKey: "begin", StepType: "IMMEDIATE"}}, Costs: []model.ProcessCostDefinition{},
		Cooldown:         &model.ProcessCooldownDefinition{DurationMs: model.GenericFormulaExpr{Op: "round", Expr: authoringAmount(model.GenericFormulaExpr{Op: "ref", Ref: "test/attack_interval_ms"})}, StartMoment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}},
		MomentOperations: []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}, Operations: []model.OperationDefinition{{Operation: model.OperationKindApplyAttackLink, Target: "target", Ref: "attack_link", Amount: authoringAmount(authoringConst(1))}}}}}
	c := model.CompileRequest{SchemaVersion: model.GenericSchemaVersion, SchemaHash: "authoring-schema", RulesHash: "authoring-rules"}
	for _, entry := range []model.TypeCatalogEntry{
		{Key: "combatant/champion", Domain: "combatant"}, {Key: "provider/skill", Domain: "provider"}, {Key: model.AbilityTypeBasicAttack, Domain: "ability"},
		{Key: "damage/physics", Domain: "damage"}, {Key: model.EventTypeBasicAttackStart, Domain: "event"}, {Key: model.EventTypeBasicAttackHit, Domain: "event"},
		{Key: model.EventTypeAttackLinkApplied, Domain: "event"}, {Key: model.EventTypeHitLinkApplied, Domain: "event"}, {Key: "event/source_owner", Domain: "event"},
	} {
		c.TypeCatalog.Types = append(c.TypeCatalog.Types, entry)
	}
	c.SharedProviders = []model.ProviderDefinition{{SkillKey: "test_attack", ProviderKey: "test_attack", Kind: "skill", StableID: "test_attack", Types: []string{"provider/skill"}, Processes: []model.ProcessDefinition{process}, Abilities: []model.AbilityDefinition{
		{AbilityKey: "native_start", Kind: "active", SkillKey: "test_attack", Types: []string{model.AbilityTypeBasicAttack}},
		{AbilityKey: "initial", Kind: "active", SkillKey: "test_attack", Types: []string{model.AbilityTypeBasicAttack}, ProcessControl: &model.ProcessControlDefinition{ProcessKey: "attack", Action: "INITIAL", UseRefFromEvent: true}},
		{AbilityKey: "native_hit", Kind: "active", SkillKey: "test_attack", Params: map[string]float64{"base_critical_multiplier": 2}, Types: []string{model.AbilityTypeBasicAttack}, Operations: []model.OperationDefinition{{Operation: model.OperationKindResolveSkillHit, Target: "target", SkillHit: &model.SkillHitDefinition{SkillKey: "test_attack", Candidates: []model.SkillHitCandidate{candidate("damage", model.SkillHitResultDamage, damage), candidate("hit_link", model.SkillHitResultHitLink, link)}}}}},
	}, Listeners: []model.ListenerDefinition{{ListenerKey: "start_process", EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackStart, "event/source_owner"}}, AbilityRef: authoringRef("initial")}}}}
	sourceAttrs := map[string]model.AttributeSlotDef{"hp": authoringSlot(1000), "attack_damage": authoringSlot(100), "attack_speed": authoringSlot(.7), "critical_strike_chance": authoringSlot(.25), "critical_strike_damage_bonus_percent": authoringSlot(.3), "armor_pen_percent": authoringSlot(.25), "armor_pen_flat": authoringSlot(10)}
	targetAttrs := map[string]model.AttributeSlotDef{"hp": authoringSlot(1000), "armor": authoringSlot(120)}
	c.Combatants = []model.CombatantDefinition{
		{Key: "source", Types: []string{"combatant/champion"}, Attributes: sourceAttrs, Resources: map[string]model.ResourceSlotDef{}, Providers: []model.CombatantProviderMount{{ProviderRef: "attack", DefinitionRef: "test_attack"}}},
		{Key: "target", Types: []string{"combatant/champion"}, Attributes: targetAttrs, Resources: map[string]model.ResourceSlotDef{}, Providers: []model.CombatantProviderMount{}},
	}
	for _, key := range []string{"armor", "armor_pen_percent", "armor_pen_flat", "attack_speed", "critical_strike_damage_bonus_percent"} {
		c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: key, Domain: "attribute"})
	}
	c.Rules.DamageTypeFormulas = []model.DamageTypeFormulaDefinition{{DamageType: "damage/physics", Formula: map[string]any{
		"inputs": []any{phase3Input("armor", "target", "armor", "TOTAL"), phase3Input("percent", "source", "armor_pen_percent", "TOTAL"), phase3Input("flat", "source", "armor_pen_flat", "TOTAL")},
		"stages": []any{
			phase3Stage("effective", phase3Binary("max", phase3Const("0"), phase3Binary("sub", phase3Binary("mul", phase3Read("armor"), phase3Binary("sub", phase3Const("1"), phase3Read("percent"))), phase3Read("flat")))),
			phase3Stage("factor", phase3Binary("div", phase3Const("100"), phase3Binary("add", phase3Const("100"), phase3Ref("effective")))),
		}, "outputStageKey": "factor",
	}}}
	c.Formulas = []model.NamedFormula{
		formuladefinition.FromExpr("test/attack_interval_ms", "test_attack", authoringBinary("div", authoringConst(1000), authoringRead("source.attr.attack_speed.resolved")), nil),
		formuladefinition.FromExpr("test/critical_multiplier", "test_attack", authoringBinary("add", authoringRead("ability.param.base_critical_multiplier"), authoringRead("source.attr.critical_strike_damage_bonus_percent.resolved")), map[string]float64{"base_critical_multiplier": 2}),
	}
	use := "attack/1"
	r := model.RunRequest{SessionID: "test-session", InitialSnapshot: model.Snapshot{SchemaHash: c.SchemaHash, RulesHash: c.RulesHash, Combatants: []model.CombatantSnapshot{
		{Key: "source", Attributes: sourceAttrs, Resources: map[string]model.ResourceSlotDef{}, Providers: []model.CombatantProviderSnapshot{{ProviderRef: "attack", DefinitionRef: "test_attack", Source: "source", Owner: "source", Stacks: 1}}},
		{Key: "target", Attributes: targetAttrs, Resources: map[string]model.ResourceSlotDef{}},
	}}, StopPolicy: model.StopPolicy{DurationMs: 100}, SkillUses: []model.SkillUseFact{{UseKey: use, Source: "source", SkillKey: "test_attack", HistoryState: model.SkillHitHistoryComplete}},
		AttackStartFacts: []model.AttackStartFact{{DriverEntryKey: "start", UseRef: use}}, SkillHitFacts: []model.SkillHitFact{{DriverEntryKey: "hit", UseRef: &use}},
		DriverPlan: model.DriverPlan{Entries: []model.DriverEntry{{EntryKey: "start", AbilityRef: authoringRef("native_start"), Source: "source", Target: "target", FirstAtMs: 0}, {EntryKey: "hit", AbilityRef: authoringRef("native_hit"), Source: "source", Target: "target", FirstAtMs: 25}}}}
	return c, r
}

func authoringCompile(t *testing.T, c model.CompileRequest) planbundle.CompiledSession {
	t.Helper()
	result := compile.CompileGeneric(c)
	if !result.OK {
		t.Fatalf("compile: %+v", result.Result.Errors)
	}
	return result.Session
}

func authoringRun(t *testing.T, c model.CompileRequest, r model.RunRequest) model.DoneResult {
	t.Helper()
	session := authoringCompile(t, c)
	r.ExpectedRulesHash = session.RulesHash
	done, err := runForTest(session, r)
	if err != nil {
		t.Fatalf("run: %+v", err)
	}
	return done
}
