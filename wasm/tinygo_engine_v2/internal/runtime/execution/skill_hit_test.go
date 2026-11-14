package execution

import (
	testing "testing"
	compile "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
)

func hitConst(v float64) model.GenericFormulaExpr {
	return model.GenericFormulaExpr{Op: "const", Value: model.Float64Ptr(v)}
}

func hitConstAmt(v float64) *model.GenericFormulaExpr {
	e := hitConst(v)
	return &e
}

func hitScope(v string) *string { return &v }

func hitUse(key string) *string { return &key }

func seqN(n int) *int { return &n }

func skillHitCatalog(req *model.CompileRequest) {
	ensureC1CatalogTypes(req,
		model.TypeCatalogEntry{Key: "status/stun_q", Domain: "status"},
		model.TypeCatalogEntry{Key: "status/airborne", Domain: "status"},
		model.TypeCatalogEntry{Key: model.EventTypeSkillHit, Domain: "event"},
		model.TypeCatalogEntry{Key: model.EventTypeSpellShieldBlocked, Domain: "event"},
		model.TypeCatalogEntry{Key: model.ProviderTypeSpellShield, Domain: "provider"},
		model.TypeCatalogEntry{Key: model.ClosedStatusKindProviderType[model.StatusKindStun], Domain: "provider"},
	)
}

func skillHitAbilityRef() string {
	return "source.provider[champion:source_demo].ability[skill_hit]"
}

func damageCand(key, occ, result, scope string, blockedEq float64) model.SkillHitCandidate {
	var sc *string
	if scope != "" {
		sc = hitScope(scope)
	}
	return model.SkillHitCandidate{
		CandidateKey: key, EffectOccurrenceKey: occ, EffectKey: "effect-" + occ, ResultKey: result,
		Semantic: model.SkillHitSemantic{
			ResultType: model.SkillHitResultDamage, Target: model.SkillHitTargetTARGET, Moment: model.SkillHitMomentInstant,
		},
		SpellShieldBlockScope: sc,
		EventValueConditions: []model.SkillHitEventValueCondition{
			{Key: model.SkillHitValueBlocked, Comparator: "eq", Value: hitConst(blockedEq)},
		},
		Operations: []model.OperationDefinition{{
			Operation: "damage", Target: "target", DamageType: "damage/physical", Amount: hitConstAmt(100), Ref: "op-" + key,
		}},
	}
}

func stunCand(key, occ, result, scope string) model.SkillHitCandidate {
	var sc *string
	if scope != "" {
		sc = hitScope(scope)
	}
	return model.SkillHitCandidate{
		CandidateKey: key, EffectOccurrenceKey: occ, EffectKey: "effect-" + occ, ResultKey: result,
		Semantic: model.SkillHitSemantic{
			ResultType: model.SkillHitResultStatusOperation, Target: model.SkillHitTargetTARGET, Moment: model.SkillHitMomentInstant,
			StatusOperation: model.StatusOperationApply, StatusKey: "stun_q", StatusKind: model.StatusKindStun,
		},
		SpellShieldBlockScope: sc,
		EventValueConditions: []model.SkillHitEventValueCondition{
			{Key: model.SkillHitValueBlocked, Comparator: "eq", Value: hitConst(0)},
		},
		Operations: []model.OperationDefinition{{
			Operation: "apply_provider", Target: "target", ProviderDefinitionRef: "status:stun",
		}},
	}
}

func nullHealCand(key, occ, result string) model.SkillHitCandidate {
	return model.SkillHitCandidate{
		CandidateKey: key, EffectOccurrenceKey: occ, EffectKey: "effect-" + occ, ResultKey: result,
		Semantic: model.SkillHitSemantic{
			ResultType: model.SkillHitResultAttributeChange, Target: model.SkillHitTargetSOURCE, Moment: model.SkillHitMomentInstant,
		},
		Operations: []model.OperationDefinition{{
			Operation: "attribute_change", Target: "source", AttributeKey: "attack_damage", ValuePolicy: "add", Amount: hitConstAmt(3),
		}},
	}
}

func stunProvider() model.ProviderDefinition {
	d := hitConst(1000)
	return model.ProviderDefinition{
		ProviderKey: "status:stun", Kind: "status", StableID: "stun",
		Types:     []string{model.ClosedStatusKindProviderType[model.StatusKindStun]},
		Lifecycle: &model.ProviderLifecycle{DurationMs: &d, MaxStacks: 1, RefreshPolicy: model.RefreshPolicyReplace},
	}
}

func spellShieldProvider() model.ProviderDefinition {
	d := hitConst(5000)
	return model.ProviderDefinition{
		ProviderKey: "shield:spell", Kind: "status", StableID: "spell_shield",
		Types:     []string{model.ProviderTypeSpellShield},
		Lifecycle: &model.ProviderLifecycle{DurationMs: &d, MaxStacks: 1, RefreshPolicy: model.RefreshPolicyReplace},
		Listeners: []model.ListenerDefinition{{
			ListenerKey:  "consume",
			EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSpellShieldBlocked}},
			Operations: []model.OperationDefinition{
				{Operation: "heal", Target: "self", Amount: hitConstAmt(40)},
				{Operation: "expire_provider", Target: "self", ProviderRefFromEvent: true},
			},
		}},
	}
}

func withSkillHit(t *testing.T, cands []model.SkillHitCandidate, extraProviders []model.ProviderDefinition, extraAbilities []model.AbilityDefinition, entries []model.DriverEntry, uses []model.SkillUseFact, facts []model.SkillHitFact, durationMs int64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := loadBasicFixture(t)
	skillHitCatalog(&c)
	raiseAttrMax(c.Combatants[0].Attributes, "attack_damage", 200)
	raiseAttrMax(c.Combatants[1].Attributes, "hp", 2000)
	raiseAttrMax(r.InitialSnapshot.Combatants[0].Attributes, "attack_damage", 200)
	raiseAttrMax(r.InitialSnapshot.Combatants[1].Attributes, "hp", 2000)
	c.SharedProviders = append(c.SharedProviders, extraProviders...)
	abilities := extraAbilities
	abilities = append(abilities, model.AbilityDefinition{
		AbilityKey: "skill_hit", Kind: "active",
		Params: map[string]float64{"gate": 1, "branch": 1},
		Operations: []model.OperationDefinition{{
			Operation: model.OperationKindResolveSkillHit, Target: "target",
			SkillHit: &model.SkillHitDefinition{SkillKey: "author:q", Candidates: cands},
		}},
	})
	c.SharedProviders[0].Abilities = abilities
	r.DriverPlan.Entries = entries
	r.SkillUses = uses
	r.SkillHitFacts = facts
	r.StopPolicy.DurationMs = durationMs
	r.StopPolicy.StopWhenNoEvents = model.BoolPtr(false)
	return c, r
}

func raiseAttrMax(attrs map[string]model.AttributeSlotDef, key string, max float64) {
	if attrs == nil {
		return
	}
	slot := attrs[key]
	slot.Max = max
	attrs[key] = slot
}

func hitEntry(key string, at int64, priority int) model.DriverEntry {
	return model.DriverEntry{
		EntryKey: key, AbilityRef: skillHitAbilityRef(),
		Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: at, Priority: priority,
	}
}

func runSkillHit(t *testing.T, c model.CompileRequest, r model.RunRequest) model.DoneResult {
	t.Helper()
	return c1Run(t, c, r)
}

func runSkillHitErr(t *testing.T, c model.CompileRequest, r model.RunRequest) *model.EngineError {
	t.Helper()
	result := compile.CompileGeneric(c)
	if !result.OK {
		t.Fatalf("compile: %+v", result.Result.Errors)
	}
	_, err := runForTest(result.Session, r)
	if err == nil {
		t.Fatal("expected run error")
	}
	return err
}

func targetHP(t *testing.T, done model.DoneResult) float64 {
	t.Helper()
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key == "target" {
			return c.Attributes["hp"].Current
		}
	}
	t.Fatal("missing target")
	return 0
}

func TestSkillHitRestoredShieldListenerConsumesExactInstance(t *testing.T) {
	c, r := withSkillHit(t, []model.SkillHitCandidate{damageCand("dmg", "occ", "rd", model.SpellShieldScopeResult, 0)},
		[]model.ProviderDefinition{spellShieldProvider()}, nil,
		[]model.DriverEntry{hitEntry("h1", 0, 0)},
		[]model.SkillUseFact{{UseKey: "u1", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}},
		[]model.SkillHitFact{{DriverEntryKey: "h1", UseRef: hitUse("u1")}}, 50)
	expire := int64(5000)
	r.InitialSnapshot.Combatants[1].Providers = []model.CombatantProviderSnapshot{{
		ProviderRef: "shield:spell#restored", DefinitionRef: "shield:spell", Source: "source", Owner: "target", Stacks: 1, ExpireAt: &expire,
	}}
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatalf("compile: %+v", compiled.Result.Errors)
	}
	var shieldListeners int
	for _, p := range compiled.Session.Providers {
		if p.ProviderKey == "shield:spell" {
			shieldListeners = len(p.Listeners)
		}
	}
	if shieldListeners != 1 {
		t.Fatalf("compiled shield listeners=%d", shieldListeners)
	}
	state, err := newGenericRunState(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	if state.listeners.DynamicLen() != 1 {
		t.Fatalf("runtime listeners=%d", state.listeners.DynamicLen())
	}
	done, err := runForTest(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	if targetHP(t, done) != 1040 {
		t.Fatalf("restored shield should block and heal owner, hp=%v", targetHP(t, done))
	}
	for _, p := range done.FinalSnapshot.Combatants[1].Providers {
		if p.ProviderRef == "shield:spell#restored" {
			t.Fatal("restored instance must be the one consumed")
		}
	}
}
