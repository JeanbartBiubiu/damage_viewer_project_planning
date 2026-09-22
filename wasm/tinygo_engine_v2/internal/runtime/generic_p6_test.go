package runtime

import (
	"math"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
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

func p6StateSet(key string, amount float64) model.OperationDefinition {
	return model.OperationDefinition{
		Operation: "state_change", Target: "source", Ref: key, ValuePolicy: "set",
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

func p6SkillHit(t *testing.T, listeners []model.ListenerDefinition, schema map[string]interface{}, hits int, sameUse bool, durationMs int64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	entries := make([]model.DriverEntry, hits)
	facts := make([]model.SkillHitFact, hits)
	uses := []model.SkillUseFact{}
	for i := 0; i < hits; i++ {
		key := "h" + itoa(uint32(i+1))
		entries[i] = model.DriverEntry{EntryKey: key, AbilityRef: skillHitAbilityRef(), Source: "source", Target: "target", FirstAtMs: int64(i) * 100}
		useKey := "use"
		if !sameUse {
			useKey = "use" + itoa(uint32(i+1))
			uses = append(uses, model.SkillUseFact{UseKey: useKey, Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete})
		}
		facts[i] = model.SkillHitFact{DriverEntryKey: key, UseRef: hitUse(useKey)}
	}
	if sameUse {
		uses = []model.SkillUseFact{{UseKey: "use", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}}
	}
	c, r := withSkillHit(t, []model.SkillHitCandidate{damageCand("dmg", "occ", "rd", "", 0)}, nil, nil, entries, uses, facts, durationMs)
	mountP6Item(&c, &r, model.ProviderDefinition{
		ProviderKey: p6ItemRef, Kind: "item", StableID: "p6",
		InitialStateSchema: schema,
		Listeners:          listeners,
	})
	return c, r
}

func p6MustRun(t *testing.T, c model.CompileRequest, r model.RunRequest) model.DoneResult {
	t.Helper()
	result := compile.CompileGeneric(c)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	r.InitialSnapshot.SchemaHash = result.Session.SchemaHash
	r.InitialSnapshot.RulesHash = result.Session.RulesHash
	done, err := RunGeneric(result.Session, r)
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
	_, err := RunGeneric(result.Session, r)
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

func p6ExpireAt(t *testing.T, done model.DoneResult, key string) float64 {
	t.Helper()
	bag := sourceProviderState(t, done.FinalSnapshot, p6ItemRef)
	expire, _ := bag["expireAt"].(map[string]interface{})
	if expire == nil {
		t.Fatalf("expireAt map missing: %+v", bag)
	}
	switch v := expire[key].(type) {
	case float64:
		return v
	case int64:
		return float64(v)
	case int:
		return float64(v)
	default:
		t.Fatalf("expireAt.%s type %T value %v", key, expire[key], expire[key])
		return 0
	}
}

func TestP6SameUseMultiHitConsumesOnce(t *testing.T) {
	listeners := []model.ListenerDefinition{{
		ListenerKey:  "once",
		EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit, "event/source_owner"}},
		OncePerUse:   &model.OncePerUseLimit{GroupKey: "proc", Scope: model.OncePerUseScopeProvider},
		Operations:   []model.OperationDefinition{p6StateAdd("procs", 1)},
	}}
	c, r := p6SkillHit(t, listeners, map[string]interface{}{"procs": p6SchemaField(0, 99, 0, "")}, 2, true, 200)
	done := p6MustRun(t, c, r)
	if p6State(t, done, "procs") != 1 {
		t.Fatalf("procs=%v want 1", p6State(t, done, "procs"))
	}
	if len(done.FinalSnapshot.UseTriggerLedger) != 1 {
		t.Fatalf("ledger=%d want 1", len(done.FinalSnapshot.UseTriggerLedger))
	}
}

func TestP6SharedGroupMutuallyExclusive(t *testing.T) {
	listeners := []model.ListenerDefinition{
		{
			ListenerKey:  "a",
			EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit, "event/source_owner"}},
			OncePerUse:   &model.OncePerUseLimit{GroupKey: "shared", Scope: model.OncePerUseScopeProvider},
			Operations:   []model.OperationDefinition{p6StateAdd("a", 1)},
		},
		{
			ListenerKey:  "b",
			EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit, "event/source_owner"}},
			OncePerUse:   &model.OncePerUseLimit{GroupKey: "shared", Scope: model.OncePerUseScopeProvider},
			Operations:   []model.OperationDefinition{p6StateAdd("b", 1)},
		},
	}
	c, r := p6SkillHit(t, listeners, map[string]interface{}{
		"a": p6SchemaField(0, 99, 0, ""),
		"b": p6SchemaField(0, 99, 0, ""),
	}, 1, true, 50)
	done := p6MustRun(t, c, r)
	if p6State(t, done, "a") != 1 || p6State(t, done, "b") != 0 {
		t.Fatalf("a=%v b=%v want 1/0", p6State(t, done, "a"), p6State(t, done, "b"))
	}
}

func TestP6NewUseAndSourceIsolation(t *testing.T) {
	listeners := []model.ListenerDefinition{{
		ListenerKey:  "once",
		EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit, "event/source_owner"}},
		OncePerUse:   &model.OncePerUseLimit{GroupKey: "proc", Scope: model.OncePerUseScopeProvider},
		Operations:   []model.OperationDefinition{p6StateAdd("procs", 1)},
	}}
	c, r := p6SkillHit(t, listeners, map[string]interface{}{"procs": p6SchemaField(0, 99, 0, "")}, 2, false, 200)
	done := p6MustRun(t, c, r)
	if p6State(t, done, "procs") != 2 {
		t.Fatalf("procs=%v want 2 for new uses", p6State(t, done, "procs"))
	}
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

func TestP6WindowFirstWriteNoRefreshAndHalfOpen(t *testing.T) {
	listeners := []model.ListenerDefinition{{
		ListenerKey:  "count",
		EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit, "event/source_owner"}},
		Operations:   []model.OperationDefinition{p6StateAdd("hits", 1)},
	}}
	schema := map[string]interface{}{
		"hits": p6SchemaField(0, 99, 200, model.ProviderStateRefreshStartOnFirstWrite),
	}
	c, r := p6SkillHit(t, listeners, schema, 2, false, 150)
	done := p6MustRun(t, c, r)
	if p6State(t, done, "hits") != 2 {
		t.Fatalf("hits=%v want 2", p6State(t, done, "hits"))
	}
	if exp := p6ExpireAt(t, done, "hits"); exp != 200 {
		t.Fatalf("expireAt.hits=%v want 200 (no refresh)", exp)
	}

	c2, r2 := p6SkillHit(t, listeners, schema, 2, false, 250)
	r2.DriverPlan.Entries[1].FirstAtMs = 200
	done2 := p6MustRun(t, c2, r2)
	if p6State(t, done2, "hits") != 1 {
		t.Fatalf("half-open expired window hits=%v want 1", p6State(t, done2, "hits"))
	}
}

func TestP6ConsumeStartsICDTimeoutDoesNot(t *testing.T) {
	reward := []model.ListenerDefinition{
		{
			ListenerKey:  "count",
			EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit, "event/source_owner"}},
			Operations:   []model.OperationDefinition{p6StateAdd("hits", 1)},
		},
		{
			ListenerKey:  "reward",
			EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit, "event/source_owner"}},
			Condition:    p6Gte("provider.state.hits", 2),
			OncePerUse:   &model.OncePerUseLimit{GroupKey: "reward", Scope: model.OncePerUseScopeProvider},
			Operations: []model.OperationDefinition{
				p6StateSet("hits", 0),
				p6StateSet("icd", 1),
			},
		},
	}
	schema := map[string]interface{}{
		"hits": p6SchemaField(0, 99, 500, model.ProviderStateRefreshStartOnFirstWrite),
		"icd":  p6SchemaField(0, 99, 1500, model.ProviderStateRefreshStartOnFirstWrite),
	}
	c, r := p6SkillHit(t, reward, schema, 3, false, 300)
	done := p6MustRun(t, c, r)
	if p6State(t, done, "icd") != 1 {
		t.Fatalf("consume icd=%v want 1", p6State(t, done, "icd"))
	}

	timeoutListeners := []model.ListenerDefinition{{
		ListenerKey:  "count",
		EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit, "event/source_owner"}},
		Operations:   []model.OperationDefinition{p6StateAdd("hits", 1)},
	}}
	c2, r2 := p6SkillHit(t, timeoutListeners, schema, 1, true, 600)
	done2 := p6MustRun(t, c2, r2)
	if p6State(t, done2, "hits") != 0 {
		t.Fatalf("timeout should clear hits, got %v", p6State(t, done2, "hits"))
	}
	if p6State(t, done2, "icd") != 0 {
		t.Fatalf("timeout must not start icd, got %v", p6State(t, done2, "icd"))
	}
}

func TestP6SameFrameOutputAndSharedQualification(t *testing.T) {
	listeners := []model.ListenerDefinition{{
		ListenerKey:  "proc",
		EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit, "event/source_owner"}},
		OncePerUse:   &model.OncePerUseLimit{GroupKey: "spellblade", Scope: model.OncePerUseScopeProvider},
		Operations: []model.OperationDefinition{
			{Operation: "damage", Target: "target", DamageType: "damage/true", Amount: p6Amt(40), OutputRef: "hit", Ref: "bonus"},
			{Operation: "resource_change", Target: "source", ResourceKey: "mana", Amount: &model.GenericFormulaExpr{
				Op: "mul", Args: []model.GenericFormulaExpr{p6Read("operation.output.hit.POST_DEFENSE_DAMAGE"), p6Expr(0.5)},
			}},
			p6StateSet("ready", 0),
			p6StateSet("icd", 1),
		},
	}}
	c, r := p6SkillHit(t, listeners, map[string]interface{}{
		"ready": p6SchemaField(1, 1, 0, ""),
		"icd":   p6SchemaField(0, 1, 1500, model.ProviderStateRefreshStartOnFirstWrite),
	}, 2, true, 200)
	ensureDamageTrueType(&c)
	p6AddMana(&c, &r, 0, 200)
	done := p6MustRun(t, c, r)
	if p6State(t, done, "ready") != 0 {
		t.Fatalf("ready=%v want 0", p6State(t, done, "ready"))
	}
	if p6State(t, done, "icd") != 1 {
		t.Fatalf("icd=%v want 1", p6State(t, done, "icd"))
	}
	mana := done.FinalSnapshot.Combatants[0].Resources["mana"].Current
	if math.Abs(mana-20) > 1e-9 {
		t.Fatalf("mana=%v want 20 from 40*0.5 once", mana)
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

func TestP6RestoreLedgerAndExpireAt(t *testing.T) {
	listeners := []model.ListenerDefinition{{
		ListenerKey:  "once",
		EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit, "event/source_owner"}},
		OncePerUse:   &model.OncePerUseLimit{GroupKey: "proc", Scope: model.OncePerUseScopeProvider},
		Operations:   []model.OperationDefinition{p6StateAdd("procs", 1)},
	}}
	c, r := p6SkillHit(t, listeners, map[string]interface{}{
		"hits":  p6SchemaField(0, 99, 2000, model.ProviderStateRefreshStartOnFirstWrite),
		"procs": p6SchemaField(0, 99, 0, ""),
	}, 1, true, 50)
	done := p6MustRun(t, c, r)
	r2 := r
	r2.InitialSnapshot = done.FinalSnapshot
	r2.SkillUses = nil
	r2.SkillHitFacts = nil
	r2.DriverPlan.Entries = nil
	r2.StopPolicy.DurationMs = 1
	done2 := p6MustRun(t, c, r2)
	if len(done2.FinalSnapshot.UseTriggerLedger) != 1 {
		t.Fatalf("restored ledger=%d", len(done2.FinalSnapshot.UseTriggerLedger))
	}
}

func TestP6LedgerBudgetAndMissingUse(t *testing.T) {
	listeners := []model.ListenerDefinition{{
		ListenerKey:  "once",
		EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit, "event/source_owner"}},
		OncePerUse:   &model.OncePerUseLimit{GroupKey: "proc", Scope: model.OncePerUseScopeProvider},
		Operations:   []model.OperationDefinition{p6StateAdd("procs", 1)},
	}}
	c, r := p6SkillHit(t, listeners, map[string]interface{}{"procs": p6SchemaField(0, 99, 0, "")}, 1, true, 50)
	rows := make([]model.UseTriggerLedgerEntry, maxUseTriggerLedger+1)
	for i := range rows {
		rows[i] = model.UseTriggerLedgerEntry{
			Owner: "source", ProviderRef: p6ItemRef, GroupKey: "proc", Scope: model.OncePerUseScopeProvider,
			UseSource: "source", UseSkillKey: "author:q", UseKey: "hist" + itoa(uint32(i)),
		}
	}
	r.InitialSnapshot.UseTriggerLedger = rows
	result := compile.CompileGeneric(c)
	if !result.OK {
		t.Fatalf("compile: %+v", result.Result.Errors)
	}
	r.InitialSnapshot.SchemaHash = result.Session.SchemaHash
	r.InitialSnapshot.RulesHash = result.Session.RulesHash
	if _, err := RunGeneric(result.Session, r); err == nil || !strings.Contains(err.Message, "budget") {
		t.Fatalf("expected budget error, got %+v", err)
	}

	c2, r2 := p6SkillHit(t, listeners, map[string]interface{}{"procs": p6SchemaField(0, 99, 0, "")}, 1, true, 50)
	r2.SkillHitFacts[0].UseRef = nil
	err := p6MustFailRun(t, c2, r2)
	if !strings.Contains(strings.ToLower(err.Message), "use") && !strings.Contains(err.Path, "oncePerUse") {
		t.Fatalf("expected missing use fact, got %+v", err)
	}
}

func TestP6FailedRunDoesNotPolluteNext(t *testing.T) {
	listeners := []model.ListenerDefinition{{
		ListenerKey:  "once",
		EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit, "event/source_owner"}},
		OncePerUse:   &model.OncePerUseLimit{GroupKey: "proc", Scope: model.OncePerUseScopeProvider},
		Operations:   []model.OperationDefinition{p6StateAdd("procs", 1)},
	}}
	c, r := p6SkillHit(t, listeners, map[string]interface{}{"procs": p6SchemaField(0, 99, 0, "")}, 1, true, 50)
	r.InitialSnapshot.UseTriggerLedger = []model.UseTriggerLedgerEntry{{}}
	_ = p6MustFailRun(t, c, r)
	c2, r2 := p6SkillHit(t, listeners, map[string]interface{}{"procs": p6SchemaField(0, 99, 0, "")}, 1, true, 50)
	done := p6MustRun(t, c2, r2)
	if p6State(t, done, "procs") != 1 {
		t.Fatalf("fresh run procs=%v want 1", p6State(t, done, "procs"))
	}
	if len(done.FinalSnapshot.UseTriggerLedger) != 1 {
		t.Fatalf("fresh ledger=%d", len(done.FinalSnapshot.UseTriggerLedger))
	}
}

func TestP6ConditionFreezeBeforeActions(t *testing.T) {
	listeners := []model.ListenerDefinition{
		{
			ListenerKey:  "bump",
			EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit, "event/source_owner"}},
			Operations:   []model.OperationDefinition{p6StateAdd("hits", 1)},
		},
		{
			ListenerKey:  "late",
			EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit, "event/source_owner"}},
			Condition:    p6Gte("provider.state.hits", 1),
			Operations:   []model.OperationDefinition{p6StateAdd("late", 1)},
		},
	}
	c, r := p6SkillHit(t, listeners, map[string]interface{}{
		"hits": p6SchemaField(0, 99, 0, ""),
		"late": p6SchemaField(0, 99, 0, ""),
	}, 1, true, 50)
	done := p6MustRun(t, c, r)
	if p6State(t, done, "hits") != 1 || p6State(t, done, "late") != 0 {
		t.Fatalf("hits=%v late=%v want freeze skip", p6State(t, done, "hits"), p6State(t, done, "late"))
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
