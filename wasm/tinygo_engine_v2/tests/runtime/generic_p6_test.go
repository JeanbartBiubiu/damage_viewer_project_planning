// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	math "math"
	strings "strings"
	testing "testing"
	compile "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
)

const p6ItemRef = "item:p6_shared"

func p6Amt(v float64) *model.GenericFormulaExpr {
	return &model.GenericFormulaExpr{Op: "const", Value: model.Float64Ptr(v)}
}

func p6SchemaField(def, max, dur float64, policy string) map[string]interface{} {
	field := map[string]interface{}{
		"defaultValue": def,
		"maxValue":     max,
		"durationMs":   dur,
	}
	if policy != "" {
		field["refreshPolicy"] = policy
	}
	return field
}

func p6Expr(v float64) model.GenericFormulaExpr {
	return model.GenericFormulaExpr{Op: "const", Value: model.Float64Ptr(v)}
}

func p6Read(path string) model.GenericFormulaExpr {
	return model.GenericFormulaExpr{Op: "read", Path: path}
}

func p6Gte(path string, n float64) *model.GenericFormulaExpr {
	return &model.GenericFormulaExpr{Op: "gte", Args: []model.GenericFormulaExpr{p6Read(path), p6Expr(n)}}
}

func p6Eq(path string, n float64) *model.GenericFormulaExpr {
	return &model.GenericFormulaExpr{Op: "eq", Args: []model.GenericFormulaExpr{p6Read(path), p6Expr(n)}}
}

func p6StateAdd(key string, amount float64) model.OperationDefinition {
	return model.OperationDefinition{
		Operation: "state_change", Target: "source", Ref: key, ValuePolicy: "add",
		Types: []string{"state_scope/provider"}, Amount: p6Amt(amount),
	}
}

func mountP6Item(c *model.CompileRequest, r *model.RunRequest, p model.ProviderDefinition) {
	ensureC1CatalogTypes(c,
		model.TypeCatalogEntry{Key: "event/source_owner", Domain: "event"},
		model.TypeCatalogEntry{Key: "state_scope/provider", Domain: "state_scope"},
		model.TypeCatalogEntry{Key: model.EventTypeBasicAttackHit, Domain: "event"},
		model.TypeCatalogEntry{Key: model.EventTypeBasicAttackStart, Domain: "event"},
		model.TypeCatalogEntry{Key: model.AbilityTypeBasicAttack, Domain: "ability"},
	)
	c.SharedProviders = append(c.SharedProviders, p)
	c.Combatants[0].Providers = append(c.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: p.ProviderKey, DefinitionRef: p.ProviderKey,
	})
	for i := range r.InitialSnapshot.Combatants {
		if r.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		r.InitialSnapshot.Combatants[i].Providers = append(r.InitialSnapshot.Combatants[i].Providers, model.CombatantProviderSnapshot{
			ProviderRef: p.ProviderKey, DefinitionRef: p.ProviderKey, Source: model.SelectorSource, Owner: model.SelectorSource, Stacks: 1,
		})
	}
}

func p6AddMana(c *model.CompileRequest, r *model.RunRequest, current, max float64) {
	if c.Combatants[0].Resources == nil {
		c.Combatants[0].Resources = map[string]model.ResourceSlotDef{}
	}
	c.Combatants[0].Resources["mana"] = model.ResourceSlotDef{Current: current, Max: max}
	for i := range r.InitialSnapshot.Combatants {
		if r.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		if r.InitialSnapshot.Combatants[i].Resources == nil {
			r.InitialSnapshot.Combatants[i].Resources = map[string]model.ResourceSlotDef{}
		}
		r.InitialSnapshot.Combatants[i].Resources["mana"] = model.ResourceSlotDef{Current: current, Max: max}
	}
}

func p6MustRun(t *testing.T, c model.CompileRequest, r model.RunRequest) model.DoneResult {
	t.Helper()
	result := compile.CompileGeneric(c)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	r.InitialSnapshot.SchemaHash = result.Session.SchemaHash
	r.InitialSnapshot.RulesHash = result.Session.RulesHash
	done, err := runtimeengine.RunGeneric(result.Session, r)
	if err != nil {
		t.Fatalf("run: %+v", err)
	}
	return done
}

func p6MustFailRun(t *testing.T, c model.CompileRequest, r model.RunRequest) *model.EngineError {
	t.Helper()
	result := compile.CompileGeneric(c)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	r.InitialSnapshot.SchemaHash = result.Session.SchemaHash
	r.InitialSnapshot.RulesHash = result.Session.RulesHash
	_, err := runtimeengine.RunGeneric(result.Session, r)
	if err == nil {
		t.Fatal("expected run failure")
	}
	return err
}

func p6State(t *testing.T, done model.DoneResult, key string) float64 {
	t.Helper()
	bag := sourceProviderState(t, done.FinalSnapshot, p6ItemRef)
	state, _ := bag["state"].(map[string]interface{})
	v, _ := state[key].(float64)
	return v
}

func TestP6TargetScopeIsolation(t *testing.T) {
	listeners := []model.ListenerDefinition{{
		ListenerKey:  "once",
		EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit, "event/source_owner"}},
		OncePerUse:   &model.OncePerUseLimit{GroupKey: "proc", Scope: model.OncePerUseScopeProviderTarget},
		Operations:   []model.OperationDefinition{p6StateAdd("procs", 1)},
	}}
	c, r := withSkillHit(t, []model.SkillHitCandidate{damageCand("dmg", "occ", "rd", "", 0)}, nil, nil,
		[]model.DriverEntry{
			{EntryKey: "h1", AbilityRef: skillHitAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
			{EntryKey: "h2", AbilityRef: skillHitAbilityRef(), Source: "source", Target: "source", FirstAtMs: 100},
		},
		[]model.SkillUseFact{{UseKey: "use", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}},
		[]model.SkillHitFact{{DriverEntryKey: "h1", UseRef: hitUse("use")}, {DriverEntryKey: "h2", UseRef: hitUse("use")}},
		200)
	mountP6Item(&c, &r, model.ProviderDefinition{
		ProviderKey: p6ItemRef, Kind: "item", StableID: "p6",
		InitialStateSchema: map[string]interface{}{"procs": p6SchemaField(0, 99, 0, "")},
		Listeners:          listeners,
	})
	done := p6MustRun(t, c, r)
	if p6State(t, done, "procs") != 2 {
		t.Fatalf("procs=%v want 2 across targets", p6State(t, done, "procs"))
	}
}

func TestP6OutputKindsZeroAndShield(t *testing.T) {
	c, r := loadBasicFixture(t)
	ensureDamageTrueType(&c)
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "state_scope/provider", Domain: "state_scope"})
	c.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{Operation: "shield", Target: "target", Amount: p6Amt(30)},
		{Operation: "damage", Target: "target", DamageType: "damage/true", Amount: p6Amt(30), OutputRef: "full"},
		{Operation: "resource_change", Target: "source", ResourceKey: "mana", Amount: &model.GenericFormulaExpr{Op: "read", Path: "operation.output.full.SHIELD_ABSORBED"}},
		{Operation: "damage", Target: "target", DamageType: "damage/true", Amount: p6Amt(0), OutputRef: "zero"},
		{Operation: "resource_change", Target: "source", ResourceKey: "mana", Amount: &model.GenericFormulaExpr{Op: "read", Path: "operation.output.zero.ACTUAL_HP_LOSS"}},
	}
	p6AddMana(&c, &r, 0, 200)
	done := p6MustRun(t, c, r)
	if math.Abs(done.FinalSnapshot.Combatants[0].Resources["mana"].Current-30) > 1e-9 {
		t.Fatalf("mana=%v want 30 from shield absorbed; zero hp loss is legal", done.FinalSnapshot.Combatants[0].Resources["mana"].Current)
	}
}

func TestP6SkippedPriorOutputReadFails(t *testing.T) {
	c, r := loadBasicFixture(t)
	ensureDamageTrueType(&c)
	zero := 0.0
	c.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{Operation: "damage", Target: "target", DamageType: "damage/true", Amount: p6Amt(10), OutputRef: "hit", Condition: &model.GenericFormulaExpr{Op: "const", Value: &zero}},
		{Operation: "heal", Target: "source", Amount: &model.GenericFormulaExpr{Op: "read", Path: "operation.output.hit.POST_DEFENSE_DAMAGE"}},
	}
	err := p6MustFailRun(t, c, r)
	if !strings.Contains(err.Message, "operation.output") {
		t.Fatalf("message=%q", err.Message)
	}
}

func TestP6NativeBasicAttackAndStart(t *testing.T) {
	c, r := loadBasicFixture(t)
	ensureNativeBasicAttackCatalog(&c)
	c.SharedProviders[0].Abilities = []model.AbilityDefinition{
		{
			AbilityKey: "aa_start", Kind: "active", SkillKey: "aa:basic", Types: []string{model.AbilityTypeBasicAttack},
			Operations: []model.OperationDefinition{},
		},
		nativeHitAbility("aa_hit", "aa:basic", []model.OperationDefinition{{
			Operation: "damage", Target: "target", DamageType: "damage/physical", Amount: p6Amt(10),
		}}),
	}
	startRef := "source.provider[champion:source_demo].ability[aa_start]"
	hitRef := "source.provider[champion:source_demo].ability[aa_hit]"
	r.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "start", AbilityRef: startRef, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "hit", AbilityRef: hitRef, Source: "source", Target: "target", FirstAtMs: 10},
	}
	r.SkillUses = []model.SkillUseFact{{UseKey: "aa1", Source: "source", SkillKey: "aa:basic", HistoryState: model.SkillHitHistoryComplete}}
	r.SkillHitFacts = []model.SkillHitFact{{DriverEntryKey: "hit", UseRef: hitUse("aa1")}}
	r.AttackStartFacts = []model.AttackStartFact{{DriverEntryKey: "start", UseRef: "aa1"}}
	r.StopPolicy.DurationMs = 50
	done := p6MustRun(t, c, r)
	if countEmittedEvents(done, model.EventTypeBasicAttackStart) != 1 {
		t.Fatalf("start emits=%d", countEmittedEvents(done, model.EventTypeBasicAttackStart))
	}
	if countEmittedEvents(done, model.EventTypeBasicAttackHit) != 1 {
		t.Fatalf("hit emits=%d", countEmittedEvents(done, model.EventTypeBasicAttackHit))
	}
	if countEmittedEvents(done, model.EventTypeSkillHit) != 0 {
		t.Fatal("basic attack must not emit skill_hit")
	}
}

func TestP6AttackStartGateFailureDoesNotEmit(t *testing.T) {
	c, r := loadBasicFixture(t)
	ensureNativeBasicAttackCatalog(&c)
	c.SharedProviders[0].Abilities = []model.AbilityDefinition{{
		AbilityKey: "aa_start", Kind: "active", SkillKey: "aa:basic", Types: []string{model.AbilityTypeBasicAttack},
		Cost:       &model.AbilityCost{ResourceKey: "mana", Amount: p6Expr(50)},
		Operations: []model.OperationDefinition{},
	}}
	p6AddMana(&c, &r, 0, 50)
	r.DriverPlan.Entries = []model.DriverEntry{{
		EntryKey: "start", AbilityRef: "source.provider[champion:source_demo].ability[aa_start]", Source: "source", Target: "target", FirstAtMs: 0,
	}}
	r.SkillUses = []model.SkillUseFact{{UseKey: "aa1", Source: "source", SkillKey: "aa:basic", HistoryState: model.SkillHitHistoryComplete}}
	r.AttackStartFacts = []model.AttackStartFact{{DriverEntryKey: "start", UseRef: "aa1"}}
	r.StopPolicy.DurationMs = 20
	done := p6MustRun(t, c, r)
	if countEmittedEvents(done, model.EventTypeBasicAttackStart) != 0 {
		t.Fatal("gate failure must not emit start")
	}
}

func TestP6BasicAttackHitDoesNotExposeSkillHitBlocked(t *testing.T) {
	c, r := loadBasicFixture(t)
	ensureNativeBasicAttackCatalog(&c)
	c.SharedProviders[0].Abilities = []model.AbilityDefinition{nativeHitAbility("aa_hit", "aa:basic", nil)}
	c.SharedProviders[0].Listeners = []model.ListenerDefinition{{
		ListenerKey:  "blocked",
		EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackHit}},
		Condition:    p6Eq(model.FormulaPathSkillHitBlocked, 0),
		Operations:   []model.OperationDefinition{{Operation: "heal", Target: "self", Amount: p6Amt(1)}},
	}}
	r.DriverPlan.Entries = []model.DriverEntry{{
		EntryKey: "hit", AbilityRef: "source.provider[champion:source_demo].ability[aa_hit]", Source: "source", Target: "target", FirstAtMs: 0,
	}}
	r.SkillUses = []model.SkillUseFact{{UseKey: "aa1", Source: "source", SkillKey: "aa:basic", HistoryState: model.SkillHitHistoryComplete}}
	r.SkillHitFacts = []model.SkillHitFact{{DriverEntryKey: "hit", UseRef: hitUse("aa1")}}
	r.StopPolicy.DurationMs = 20
	err := p6MustFailRun(t, c, r)
	if !strings.Contains(err.Message, "skill_hit") && !strings.Contains(err.Path, "condition") {
		t.Fatalf("expected blocked leak to fail, got %+v", err)
	}
}
