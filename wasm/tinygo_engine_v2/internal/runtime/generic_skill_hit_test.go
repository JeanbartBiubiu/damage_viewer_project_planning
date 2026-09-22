package runtime

import (
	"strings"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
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
	_, err := RunGeneric(result.Session, r)
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

func skillHitItems(done model.DoneResult) []model.EvidenceItem {
	var out []model.EvidenceItem
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindSkillHit {
			out = append(out, item)
		}
	}
	return out
}

func TestSkillHitFirstThenSubsequentContact(t *testing.T) {
	c, r := withSkillHit(t, []model.SkillHitCandidate{damageCand("dmg", "occ", "rd", "", 0)}, nil, nil,
		[]model.DriverEntry{hitEntry("h1", 0, 0), hitEntry("h2", 100, 0)},
		[]model.SkillUseFact{{UseKey: "u1", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}},
		[]model.SkillHitFact{
			{DriverEntryKey: "h1", UseRef: hitUse("u1")},
			{DriverEntryKey: "h2", UseRef: hitUse("u1")},
		}, 200)
	done := runSkillHit(t, c, r)
	hits := skillHitItems(done)
	if len(hits) != 2 {
		t.Fatalf("hits=%d", len(hits))
	}
	if hits[0].Data["firstContact"] != 1.0 {
		t.Fatalf("first=%v", hits[0].Data["firstContact"])
	}
	if hits[1].Data["firstContact"] != 0.0 {
		t.Fatalf("second=%v", hits[1].Data["firstContact"])
	}
	if targetHP(t, done) != 800 {
		t.Fatalf("hp=%v", targetHP(t, done))
	}
}

func TestSkillHitNewUseIsIndependent(t *testing.T) {
	c, r := withSkillHit(t, []model.SkillHitCandidate{damageCand("dmg", "occ", "rd", "", 0)}, nil, nil,
		[]model.DriverEntry{hitEntry("h1", 0, 0), hitEntry("h2", 100, 0)},
		[]model.SkillUseFact{
			{UseKey: "u1", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete},
			{UseKey: "u2", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete},
		},
		[]model.SkillHitFact{
			{DriverEntryKey: "h1", UseRef: hitUse("u1")},
			{DriverEntryKey: "h2", UseRef: hitUse("u2")},
		}, 200)
	done := runSkillHit(t, c, r)
	hits := skillHitItems(done)
	if hits[0].Data["firstContact"] != 1.0 || hits[1].Data["firstContact"] != 1.0 {
		t.Fatalf("new use should be first: %+v", hits)
	}
}

func TestSkillHitZeroDamageStillCountsHistory(t *testing.T) {
	zero := damageCand("dmg", "occ", "rd", "", 0)
	zero.Operations[0].Amount = hitConstAmt(0)
	c, r := withSkillHit(t, []model.SkillHitCandidate{zero}, nil, nil,
		[]model.DriverEntry{hitEntry("h1", 0, 0), hitEntry("h2", 100, 0)},
		[]model.SkillUseFact{{UseKey: "u1", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}},
		[]model.SkillHitFact{{DriverEntryKey: "h1", UseRef: hitUse("u1")}, {DriverEntryKey: "h2", UseRef: hitUse("u1")}}, 200)
	done := runSkillHit(t, c, r)
	hits := skillHitItems(done)
	if hits[1].Data["firstContact"] != 0.0 {
		t.Fatalf("zero damage must still count: %+v", hits[1].Data)
	}
	if targetHP(t, done) != 1000 {
		t.Fatalf("hp=%v", targetHP(t, done))
	}
}

func TestSkillHitUnorderedSameTimeMissingUnlessPrior(t *testing.T) {
	c, r := withSkillHit(t, []model.SkillHitCandidate{damageCand("dmg", "occ", "rd", "", 0)}, nil, nil,
		[]model.DriverEntry{hitEntry("h1", 0, 1), hitEntry("h2", 0, 0)},
		[]model.SkillUseFact{{UseKey: "u1", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}},
		[]model.SkillHitFact{{DriverEntryKey: "h1", UseRef: hitUse("u1")}, {DriverEntryKey: "h2", UseRef: hitUse("u1")}}, 50)
	done := runSkillHit(t, c, r)
	for _, hit := range skillHitItems(done) {
		if _, ok := hit.Data["firstContact"]; ok {
			t.Fatalf("unordered first group must omit firstContact: %+v", hit.Data)
		}
	}

	c2, r2 := withSkillHit(t, []model.SkillHitCandidate{damageCand("dmg", "occ", "rd", "", 0)}, nil, nil,
		[]model.DriverEntry{hitEntry("h1", 0, 1), hitEntry("h2", 0, 0)},
		[]model.SkillUseFact{{UseKey: "u1", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete, PriorQualifiedContacts: []string{"target"}}},
		[]model.SkillHitFact{{DriverEntryKey: "h1", UseRef: hitUse("u1")}, {DriverEntryKey: "h2", UseRef: hitUse("u1")}}, 50)
	done2 := runSkillHit(t, c2, r2)
	for _, hit := range skillHitItems(done2) {
		if hit.Data["firstContact"] != 0.0 {
			t.Fatalf("complete prior must still be 0: %+v", hit.Data)
		}
	}
}

func TestSkillHitPriorityBeatsEntriesIndex(t *testing.T) {
	c, r := withSkillHit(t, []model.SkillHitCandidate{damageCand("dmg", "occ", "rd", "", 0)}, nil, nil,
		[]model.DriverEntry{hitEntry("early-in-array", 0, 5), hitEntry("low-priority", 0, 0)},
		[]model.SkillUseFact{{UseKey: "u1", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}},
		[]model.SkillHitFact{
			{DriverEntryKey: "early-in-array", UseRef: hitUse("u1"), Sequence: seqN(1)},
			{DriverEntryKey: "low-priority", UseRef: hitUse("u1"), Sequence: seqN(0)},
		}, 50)
	done := runSkillHit(t, c, r)
	hits := skillHitItems(done)
	if len(hits) != 2 {
		t.Fatalf("hits=%d", len(hits))
	}
	if hits[0].Data["firstContact"] != 1.0 || hits[1].Data["firstContact"] != 0.0 {
		t.Fatalf("heap order should follow priority: %+v %+v", hits[0].Data, hits[1].Data)
	}
}

func TestSkillHitSequenceContradictsPriority(t *testing.T) {
	c, r := withSkillHit(t, []model.SkillHitCandidate{damageCand("dmg", "occ", "rd", "", 0)}, nil, nil,
		[]model.DriverEntry{hitEntry("early-in-array", 0, 5), hitEntry("low-priority", 0, 0)},
		[]model.SkillUseFact{{UseKey: "u1", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}},
		[]model.SkillHitFact{
			{DriverEntryKey: "early-in-array", UseRef: hitUse("u1"), Sequence: seqN(0)},
			{DriverEntryKey: "low-priority", UseRef: hitUse("u1"), Sequence: seqN(1)},
		}, 50)
	err := runSkillHitErr(t, c, r)
	if !strings.Contains(err.Message, "heap order") {
		t.Fatalf("want heap order error, got %+v", err)
	}
}

func TestSkillHitGateSkipAndFutureNotCounted(t *testing.T) {
	c, r := withSkillHit(t, []model.SkillHitCandidate{damageCand("dmg", "occ", "rd", "", 0)}, nil,
		[]model.AbilityDefinition{{
			AbilityKey: "gated", Kind: "active",
			CastCondition: &model.GenericFormulaExpr{Op: "eq", Args: []model.GenericFormulaExpr{hitConst(0), hitConst(1)}},
			Operations: []model.OperationDefinition{{
				Operation: model.OperationKindResolveSkillHit, Target: "target",
				SkillHit: &model.SkillHitDefinition{SkillKey: "author:q", Candidates: []model.SkillHitCandidate{damageCand("dmg", "occ", "rd", "", 0)}},
			}},
		}},
		[]model.DriverEntry{
			hitEntry("h1", 0, 0),
			{EntryKey: "skip", AbilityRef: "source.provider[champion:source_demo].ability[gated]", Source: "source", Target: "target", FirstAtMs: 50},
			hitEntry("h2", 100, 0),
			hitEntry("future", 5000, 0),
		},
		[]model.SkillUseFact{{UseKey: "u1", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}},
		[]model.SkillHitFact{
			{DriverEntryKey: "h1", UseRef: hitUse("u1")},
			{DriverEntryKey: "skip", UseRef: hitUse("u1")},
			{DriverEntryKey: "h2", UseRef: hitUse("u1")},
			{DriverEntryKey: "future", UseRef: hitUse("u1")},
		}, 200)
	done := runSkillHit(t, c, r)
	hits := skillHitItems(done)
	if len(hits) != 2 {
		t.Fatalf("gate skip and future must not resolve: %d", len(hits))
	}
	if hits[1].Data["firstContact"] != 0.0 {
		t.Fatalf("second actual resolve is subsequent: %+v", hits[1].Data)
	}
}

func TestSkillHitNoShieldDamageAndControlApply(t *testing.T) {
	c, r := withSkillHit(t,
		[]model.SkillHitCandidate{
			damageCand("dmg", "occ", "rd", model.SpellShieldScopeSkill, 0),
			stunCand("stun", "occ", "rs", model.SpellShieldScopeResult),
		},
		[]model.ProviderDefinition{stunProvider()}, nil,
		[]model.DriverEntry{hitEntry("h1", 0, 0)},
		[]model.SkillUseFact{{UseKey: "u1", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}},
		[]model.SkillHitFact{{DriverEntryKey: "h1", UseRef: hitUse("u1")}}, 200)
	done := runSkillHit(t, c, r)
	if targetHP(t, done) != 900 {
		t.Fatalf("hp=%v", targetHP(t, done))
	}
	foundStun := false
	for _, p := range done.FinalSnapshot.Combatants[1].Providers {
		if p.DefinitionRef == "status:stun" {
			foundStun = true
		}
	}
	if !foundStun {
		t.Fatal("stun should apply without shield")
	}
}

func TestSkillHitShieldBlocksDamageAndControlTogether(t *testing.T) {
	c, r := withSkillHit(t,
		[]model.SkillHitCandidate{
			damageCand("dmg", "occ", "rd", model.SpellShieldScopeSkill, 0),
			stunCand("stun", "occ", "rs", model.SpellShieldScopeResult),
		},
		[]model.ProviderDefinition{stunProvider(), spellShieldProvider()},
		[]model.AbilityDefinition{{
			AbilityKey: "grant", Kind: "active",
			Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: "shield:spell"}},
		}},
		[]model.DriverEntry{
			{EntryKey: "grant", AbilityRef: "source.provider[champion:source_demo].ability[grant]", Source: "source", Target: "target", FirstAtMs: 0},
			hitEntry("h1", 10, 0),
		},
		[]model.SkillUseFact{{UseKey: "u1", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}},
		[]model.SkillHitFact{{DriverEntryKey: "h1", UseRef: hitUse("u1")}}, 100)
	done := runSkillHit(t, c, r)
	if targetHP(t, done) != 1040 {
		t.Fatalf("blocked damage + self heal 40, hp=%v", targetHP(t, done))
	}
	hits := skillHitItems(done)
	if hits[0].Data["blocked"] != 1.0 {
		t.Fatalf("blocked=%v", hits[0].Data["blocked"])
	}
	for _, p := range done.FinalSnapshot.Combatants[1].Providers {
		if p.DefinitionRef == "status:stun" {
			t.Fatal("stun must be blocked with damage")
		}
		if p.DefinitionRef == "shield:spell" {
			t.Fatal("explicit consume should remove the exact shield instance")
		}
	}
	if len(emittedEventsByRef(done, model.EventTypeSpellShieldBlocked)) == 0 {
		t.Fatal("missing spell_shield_blocked")
	}
}

func TestSkillHitNullStillRunsAndOnlyNullDoesNotConsumeShield(t *testing.T) {
	c, r := withSkillHit(t, []model.SkillHitCandidate{nullHealCand("buff", "occ", "rb")},
		[]model.ProviderDefinition{spellShieldProvider()},
		[]model.AbilityDefinition{{
			AbilityKey: "grant", Kind: "active",
			Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: "shield:spell"}},
		}},
		[]model.DriverEntry{
			{EntryKey: "grant", AbilityRef: "source.provider[champion:source_demo].ability[grant]", Source: "source", Target: "target", FirstAtMs: 0},
			hitEntry("h1", 10, 0),
		},
		[]model.SkillUseFact{{UseKey: "u1", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}},
		[]model.SkillHitFact{{DriverEntryKey: "h1", UseRef: hitUse("u1")}}, 100)
	done := runSkillHit(t, c, r)
	hits := skillHitItems(done)
	if hits[0].Data["blocked"] != 0.0 {
		t.Fatalf("only-null must not create a block: %+v", hits[0].Data)
	}
	foundShield := false
	for _, p := range done.FinalSnapshot.Combatants[1].Providers {
		if strings.HasPrefix(p.DefinitionRef, "shield:spell") {
			foundShield = true
		}
	}
	if !foundShield {
		t.Fatal("only-null must not consume shield")
	}
	if done.FinalSnapshot.Combatants[0].Attributes["attack_damage"].Base != 103 {
		t.Fatalf("null candidate should still execute, ad=%v", done.FinalSnapshot.Combatants[0].Attributes["attack_damage"].Base)
	}
}

func TestSkillHitFourScopesIsolateNextOccurrence(t *testing.T) {
	for _, scope := range []string{model.SpellShieldScopeEffect, model.SpellShieldScopeResult, model.SpellShieldScopeDamageInstance} {
		c, r := withSkillHit(t, []model.SkillHitCandidate{damageCand("dmg", "occ", "rd", scope, 0)},
			[]model.ProviderDefinition{spellShieldProvider()},
			[]model.AbilityDefinition{{
				AbilityKey: "grant", Kind: "active",
				Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: "shield:spell"}},
			}},
			[]model.DriverEntry{
				{EntryKey: "grant", AbilityRef: "source.provider[champion:source_demo].ability[grant]", Source: "source", Target: "target", FirstAtMs: 0},
				hitEntry("h1", 10, 0),
				hitEntry("h2", 20, 0),
			},
			[]model.SkillUseFact{{UseKey: "u1", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}},
			[]model.SkillHitFact{{DriverEntryKey: "h1", UseRef: hitUse("u1")}, {DriverEntryKey: "h2", UseRef: hitUse("u1")}}, 80)
		done := runSkillHit(t, c, r)
		hits := skillHitItems(done)
		if hits[0].Data["blocked"] != 1.0 {
			t.Fatalf("%s first blocked=%v", scope, hits[0].Data["blocked"])
		}
		if hits[1].Data["blocked"] != 0.0 {
			t.Fatalf("%s second must not inherit: %+v", scope, hits[1].Data)
		}
	}
}

func TestSkillHitSkillLedgerSurvivesConsumeAndNewUseDoesNot(t *testing.T) {
	c, r := withSkillHit(t, []model.SkillHitCandidate{damageCand("dmg", "occ", "rd", model.SpellShieldScopeSkill, 0)},
		[]model.ProviderDefinition{spellShieldProvider()},
		[]model.AbilityDefinition{{
			AbilityKey: "grant", Kind: "active",
			Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: "shield:spell"}},
		}},
		[]model.DriverEntry{
			{EntryKey: "grant", AbilityRef: "source.provider[champion:source_demo].ability[grant]", Source: "source", Target: "target", FirstAtMs: 0},
			hitEntry("h1", 10, 0),
			hitEntry("h2", 20, 0),
			hitEntry("h3", 30, 0),
		},
		[]model.SkillUseFact{
			{UseKey: "u1", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete},
			{UseKey: "u2", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete},
		},
		[]model.SkillHitFact{
			{DriverEntryKey: "h1", UseRef: hitUse("u1")},
			{DriverEntryKey: "h2", UseRef: hitUse("u1")},
			{DriverEntryKey: "h3", UseRef: hitUse("u2")},
		}, 80)
	done := runSkillHit(t, c, r)
	hits := skillHitItems(done)
	if hits[0].Data["blocked"] != 1.0 || hits[1].Data["blocked"] != 1.0 {
		t.Fatalf("SKILL should keep blocking old use: %+v %+v", hits[0].Data, hits[1].Data)
	}
	if hits[1].Data["reused"] != true {
		t.Fatalf("second SKILL should reuse: %+v", hits[1].Data)
	}
	if hits[2].Data["blocked"] != 0.0 {
		t.Fatalf("new use must not inherit: %+v", hits[2].Data)
	}
	if len(emittedEventsByRef(done, model.EventTypeSpellShieldBlocked)) != 1 {
		t.Fatalf("reuse must not re-emit block event: %d", len(emittedEventsByRef(done, model.EventTypeSpellShieldBlocked)))
	}
}

func TestSkillHitMissingFactErrors(t *testing.T) {
	c, r := withSkillHit(t, []model.SkillHitCandidate{damageCand("dmg", "occ", "rd", "", 0)}, nil, nil,
		[]model.DriverEntry{hitEntry("h1", 0, 0)}, nil, nil, 50)
	err := runSkillHitErr(t, c, r)
	if !strings.Contains(strings.ToLower(err.Message), "fact") && err.Path != "skillHitFacts" {
		t.Fatalf("missing fact: %+v", err)
	}
}

func TestSkillHitRepeatDriverRejected(t *testing.T) {
	c, r := withSkillHit(t, []model.SkillHitCandidate{damageCand("dmg", "occ", "rd", "", 0)}, nil, nil,
		[]model.DriverEntry{{
			EntryKey: "h1", AbilityRef: skillHitAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0,
			Repeat: &model.DriverRepeat{IntervalMs: 100, MaxAttempts: 2},
		}},
		[]model.SkillUseFact{{UseKey: "u1", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}},
		[]model.SkillHitFact{{DriverEntryKey: "h1", UseRef: hitUse("u1")}}, 200)
	err := runSkillHitErr(t, c, r)
	if !strings.Contains(err.Message, "Repeat") {
		t.Fatalf("repeat driver: %+v", err)
	}
}

func TestSkillHitMultipleShieldsError(t *testing.T) {
	c, r := withSkillHit(t, []model.SkillHitCandidate{damageCand("dmg", "occ", "rd", model.SpellShieldScopeSkill, 0)},
		[]model.ProviderDefinition{spellShieldProvider()},
		[]model.AbilityDefinition{{
			AbilityKey: "grant", Kind: "active",
			Operations: []model.OperationDefinition{
				{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: "shield:spell"},
				{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: "shield:spell"},
			},
		}},
		[]model.DriverEntry{
			{EntryKey: "grant", AbilityRef: "source.provider[champion:source_demo].ability[grant]", Source: "source", Target: "target", FirstAtMs: 0},
			hitEntry("h1", 10, 0),
		},
		[]model.SkillUseFact{{UseKey: "u1", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}},
		[]model.SkillHitFact{{DriverEntryKey: "h1", UseRef: hitUse("u1")}}, 50)
	err := runSkillHitErr(t, c, r)
	if !strings.Contains(err.Message, "multiple") {
		t.Fatalf("multi shield: %+v", err)
	}
}

func TestSkillHitIncompatibleUnitsFail(t *testing.T) {
	c, r := withSkillHit(t, []model.SkillHitCandidate{
		damageCand("dmg", "occ", "rd", model.SpellShieldScopeResult, 0),
		stunCand("stun", "occ2", "rs", model.SpellShieldScopeSkill),
	}, []model.ProviderDefinition{stunProvider()}, nil,
		[]model.DriverEntry{hitEntry("h1", 0, 0)},
		[]model.SkillUseFact{{UseKey: "u1", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}},
		[]model.SkillHitFact{{DriverEntryKey: "h1", UseRef: hitUse("u1")}}, 50)
	err := runSkillHitErr(t, c, r)
	if !strings.Contains(err.Message, "incompatible") {
		t.Fatalf("incompatible units: %+v", err)
	}
}

func TestSkillHitSkillScopeRequiresUseRef(t *testing.T) {
	c, r := withSkillHit(t, []model.SkillHitCandidate{damageCand("dmg", "occ", "rd", model.SpellShieldScopeSkill, 0)},
		[]model.ProviderDefinition{spellShieldProvider()},
		[]model.AbilityDefinition{{
			AbilityKey: "grant", Kind: "active",
			Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: "shield:spell"}},
		}},
		[]model.DriverEntry{
			{EntryKey: "grant", AbilityRef: "source.provider[champion:source_demo].ability[grant]", Source: "source", Target: "target", FirstAtMs: 0},
			hitEntry("h1", 10, 0),
		},
		nil,
		[]model.SkillHitFact{{DriverEntryKey: "h1"}}, 50)
	err := runSkillHitErr(t, c, r)
	if !strings.Contains(err.Message, "useRef") && !strings.Contains(err.Path, "useRef") {
		t.Fatalf("SKILL without useRef: %+v", err)
	}
}

func TestSkillHitORPredicateAndHalfThreshold(t *testing.T) {
	cand := damageCand("dmg", "occ", "rd", "", 0)
	one, two := 1.0, 2.0
	cand.ParticipationCondition = &model.GenericFormulaExpr{
		Op: "max",
		Args: []model.GenericFormulaExpr{
			{Op: "eq", Args: []model.GenericFormulaExpr{{Op: "read", Path: "ability.param.branch"}, {Op: "const", Value: &one}}},
			{Op: "eq", Args: []model.GenericFormulaExpr{{Op: "read", Path: "ability.param.branch"}, {Op: "const", Value: &two}}},
		},
	}
	cand.EventValueConditions = append(cand.EventValueConditions, model.SkillHitEventValueCondition{
		Key: model.SkillHitValueBlocked, Comparator: "gte", Value: hitConst(-1),
	})
	c, r := withSkillHit(t, []model.SkillHitCandidate{cand}, nil, nil,
		[]model.DriverEntry{hitEntry("h1", 0, 0)},
		[]model.SkillUseFact{{UseKey: "u1", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}},
		[]model.SkillHitFact{{DriverEntryKey: "h1", UseRef: hitUse("u1")}}, 50)
	done := runSkillHit(t, c, r)
	if targetHP(t, done) != 900 {
		t.Fatalf("OR predicate should allow the candidate, hp=%v", targetHP(t, done))
	}
}

func TestSkillHitMissingFirstContactFormulaPath(t *testing.T) {
	cand := damageCand("dmg", "occ", "rd", "", 0)
	cand.Operations = []model.OperationDefinition{{
		Operation: "damage", Target: "target", DamageType: "damage/physical",
		Amount: &model.GenericFormulaExpr{Op: "read", Path: model.FormulaPathSkillHitFirstContact},
	}}
	c, r := withSkillHit(t, []model.SkillHitCandidate{cand}, nil, nil,
		[]model.DriverEntry{hitEntry("h1", 0, 0), hitEntry("h2", 0, 1)},
		[]model.SkillUseFact{{UseKey: "u1", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}},
		[]model.SkillHitFact{{DriverEntryKey: "h1", UseRef: hitUse("u1")}, {DriverEntryKey: "h2", UseRef: hitUse("u1")}}, 50)
	err := runSkillHitErr(t, c, r)
	if err.Path != model.FormulaPathSkillHitFirstContact {
		t.Fatalf("want path %s got %+v", model.FormulaPathSkillHitFirstContact, err)
	}
}

func TestSkillHitUnknownHistoryAlwaysMissing(t *testing.T) {
	c, r := withSkillHit(t, []model.SkillHitCandidate{damageCand("dmg", "occ", "rd", "", 0)}, nil, nil,
		[]model.DriverEntry{hitEntry("h1", 0, 0)},
		[]model.SkillUseFact{{UseKey: "u1", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryUnknown, PriorQualifiedContacts: []string{"target"}}},
		[]model.SkillHitFact{{DriverEntryKey: "h1", UseRef: hitUse("u1")}}, 50)
	done := runSkillHit(t, c, r)
	if _, ok := skillHitItems(done)[0].Data["firstContact"]; ok {
		t.Fatalf("unknown history must not claim firstContact: %+v", skillHitItems(done)[0].Data)
	}
}

func TestSkillHitSameSessionRepeatRunDoesNotLeak(t *testing.T) {
	c, r := withSkillHit(t, []model.SkillHitCandidate{damageCand("dmg", "occ", "rd", "", 0)}, nil, nil,
		[]model.DriverEntry{hitEntry("h1", 0, 0)},
		[]model.SkillUseFact{{UseKey: "u1", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}},
		[]model.SkillHitFact{{DriverEntryKey: "h1", UseRef: hitUse("u1")}}, 50)
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatalf("compile: %+v", compiled.Result.Errors)
	}
	first, err := RunGeneric(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	second, err := RunGeneric(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	if skillHitItems(first)[0].Data["firstContact"] != 1.0 || skillHitItems(second)[0].Data["firstContact"] != 1.0 {
		t.Fatalf("repeat run leaked history: %+v %+v", skillHitItems(first)[0].Data, skillHitItems(second)[0].Data)
	}
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
	if len(state.runtimeListeners) != 1 {
		t.Fatalf("runtime listeners=%d", len(state.runtimeListeners))
	}
	done, err := RunGeneric(compiled.Session, r)
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

func TestSkillHitBlockedStillCountsHistory(t *testing.T) {
	c, r := withSkillHit(t, []model.SkillHitCandidate{damageCand("dmg", "occ", "rd", model.SpellShieldScopeSkill, 0)},
		[]model.ProviderDefinition{spellShieldProvider()},
		[]model.AbilityDefinition{{
			AbilityKey: "grant", Kind: "active",
			Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: "shield:spell"}},
		}},
		[]model.DriverEntry{
			{EntryKey: "grant", AbilityRef: "source.provider[champion:source_demo].ability[grant]", Source: "source", Target: "target", FirstAtMs: 0},
			hitEntry("h1", 10, 0),
			hitEntry("h2", 20, 0),
		},
		[]model.SkillUseFact{{UseKey: "u1", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}},
		[]model.SkillHitFact{{DriverEntryKey: "h1", UseRef: hitUse("u1")}, {DriverEntryKey: "h2", UseRef: hitUse("u1")}}, 80)
	done := runSkillHit(t, c, r)
	hits := skillHitItems(done)
	if hits[1].Data["firstContact"] != 0.0 {
		t.Fatalf("blocked contact still counts: %+v", hits[1].Data)
	}
}

func TestSkillHitNullAndDamageTogetherNullStillRuns(t *testing.T) {
	c, r := withSkillHit(t, []model.SkillHitCandidate{
		damageCand("dmg", "occ", "rd", model.SpellShieldScopeSkill, 0),
		nullHealCand("buff", "occ", "rb"),
	}, []model.ProviderDefinition{spellShieldProvider()},
		[]model.AbilityDefinition{{
			AbilityKey: "grant", Kind: "active",
			Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: "shield:spell"}},
		}},
		[]model.DriverEntry{
			{EntryKey: "grant", AbilityRef: "source.provider[champion:source_demo].ability[grant]", Source: "source", Target: "target", FirstAtMs: 0},
			hitEntry("h1", 10, 0),
		},
		[]model.SkillUseFact{{UseKey: "u1", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}},
		[]model.SkillHitFact{{DriverEntryKey: "h1", UseRef: hitUse("u1")}}, 50)
	done := runSkillHit(t, c, r)
	if done.FinalSnapshot.Combatants[0].Attributes["attack_damage"].Base != 103 {
		t.Fatalf("null still executes when siblings are blocked, ad=%v", done.FinalSnapshot.Combatants[0].Attributes["attack_damage"].Base)
	}
	if len(providerEvidence(done, model.EvidenceKindSkillHitSkip)) == 0 {
		t.Fatal("blocked damage should record skip not zero damage")
	}
}
