package runtime

import (
	"testing"
	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func TestSkillHitAnyPriorQualifiedUnitMakesContactNonFirst(t *testing.T) {
	for _, unordered := range []bool{false, true} {
		entries := []model.DriverEntry{hitEntry("h1", 0, 0)}
		facts := []model.SkillHitFact{{DriverEntryKey: "h1", UseRef: hitUse("use")}}
		if unordered {
			entries = append(entries, hitEntry("h2", 0, 0))
			facts = append(facts, model.SkillHitFact{DriverEntryKey: "h2", UseRef: hitUse("use")})
		}
		c, r := withSkillHit(t, []model.SkillHitCandidate{damageCand("d", "e", "r", "", 0)}, nil, nil, entries,
			[]model.SkillUseFact{{UseKey: "use", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete, PriorQualifiedContacts: []string{"off-field-minion"}}}, facts, 50)
		done := runSkillHit(t, c, r)
		for _, hit := range skillHitItems(done) {
			if hit.Data["firstContact"] != 0.0 {
				t.Fatalf("any prior qualified unit proves non-first, unordered=%v hit=%+v", unordered, hit.Data)
			}
		}
	}
}

func TestSkillHitOnlyNullDoesNotReuseSkillBlockFlag(t *testing.T) {
	nullAbility := model.AbilityDefinition{AbilityKey: "null_hit", Kind: "active", Operations: []model.OperationDefinition{{Operation: model.OperationKindResolveSkillHit, Target: "target", SkillHit: &model.SkillHitDefinition{SkillKey: "author:q", Candidates: []model.SkillHitCandidate{nullHealCand("buff", "e2", "r2")}}}}}
	c, r := withSkillHit(t, []model.SkillHitCandidate{damageCand("d", "e", "r", model.SpellShieldScopeSkill, 0)}, []model.ProviderDefinition{spellShieldProvider()},
		[]model.AbilityDefinition{{AbilityKey: "grant", Kind: "active", Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: "shield:spell"}}}, nullAbility},
		[]model.DriverEntry{{EntryKey: "grant", AbilityRef: "source.provider[champion:source_demo].ability[grant]", Source: "source", Target: "target", FirstAtMs: 0}, hitEntry("h1", 10, 0), {EntryKey: "h2", AbilityRef: "source.provider[champion:source_demo].ability[null_hit]", Source: "source", Target: "target", FirstAtMs: 20}},
		[]model.SkillUseFact{{UseKey: "use", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}},
		[]model.SkillHitFact{{DriverEntryKey: "h1", UseRef: hitUse("use")}, {DriverEntryKey: "h2", UseRef: hitUse("use")}}, 80)
	done := runSkillHit(t, c, r)
	hits := skillHitItems(done)
	if len(hits) != 2 || hits[0].Data["blocked"] != 1.0 || hits[1].Data["blocked"] != 0.0 {
		t.Fatalf("null-only contact must not inherit block: %+v", hits)
	}
}

func TestSkillHitPartialSequenceStillRejectsKnownContradiction(t *testing.T) {
	c, r := withSkillHit(t, []model.SkillHitCandidate{damageCand("d", "e", "r", "", 0)}, nil, nil,
		[]model.DriverEntry{hitEntry("h1", 0, 0), hitEntry("h2", 0, 0), hitEntry("h3", 0, 0)},
		[]model.SkillUseFact{{UseKey: "use", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}},
		[]model.SkillHitFact{{DriverEntryKey: "h1", UseRef: hitUse("use"), Sequence: seqN(2)}, {DriverEntryKey: "h2", UseRef: hitUse("use")}, {DriverEntryKey: "h3", UseRef: hitUse("use"), Sequence: seqN(1)}}, 80)
	runSkillHitErr(t, c, r)
}

func TestSkillHitPostBlockedComparisonsCannotCreateTheirOwnShieldBlock(t *testing.T) {
	for _, comparator := range []string{"gt", "gte", "eq", "ne"} {
		threshold := 0.5
		if comparator == "eq" {
			threshold = 1
		}
		if comparator == "ne" {
			threshold = 0
		}
		candidate := damageCand("d", "e", "r", model.SpellShieldScopeSkill, 0)
		candidate.EventValueConditions = []model.SkillHitEventValueCondition{{Key: model.SkillHitValueBlocked, Comparator: comparator, Value: hitConst(threshold)}}
		c, _ := withSkillHit(t, []model.SkillHitCandidate{candidate}, nil, nil, nil, nil, nil, 50)
		if got := compile.CompileGeneric(c); got.OK {
			t.Fatalf("blocked %s %v cannot be an incoming candidate", comparator, threshold)
		}
	}
}

func TestSkillHitCannotLabelDamageAsUnblockableModifier(t *testing.T) {
	for _, kind := range []string{model.SkillHitResultDamageImmunity, model.SkillHitResultDamageModifier, model.SkillHitResultHealingModifier, model.SkillHitResultHealthFloor} {
		candidate := damageCand("d", "e", "r", "", 0)
		candidate.Semantic.ResultType = kind
		candidate.Semantic.Moment = model.SkillHitMomentPersistent
		c, _ := withSkillHit(t, []model.SkillHitCandidate{candidate}, nil, nil, nil, nil, nil, 50)
		if got := compile.CompileGeneric(c); got.OK {
			t.Fatalf("damage op cannot masquerade as %s", kind)
		}
	}
}

func TestSkillHitOnlyTheBlockedShieldListenerReceivesItsInstanceEvent(t *testing.T) {
	c, r := withSkillHit(t, []model.SkillHitCandidate{damageCand("d", "e", "r", model.SpellShieldScopeSkill, 0)}, []model.ProviderDefinition{spellShieldProvider()},
		[]model.AbilityDefinition{{AbilityKey: "grant", Kind: "active", Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: "shield:spell"}}}},
		[]model.DriverEntry{{EntryKey: "own", AbilityRef: "source.provider[champion:source_demo].ability[grant]", Source: "source", Target: "source", FirstAtMs: 0}, {EntryKey: "enemy", AbilityRef: "source.provider[champion:source_demo].ability[grant]", Source: "source", Target: "target", FirstAtMs: 1}, hitEntry("h1", 10, 0)},
		[]model.SkillUseFact{{UseKey: "use", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}}, []model.SkillHitFact{{DriverEntryKey: "h1", UseRef: hitUse("use")}}, 80)
	done := runSkillHit(t, c, r)
	if targetHP(t, done) != 1040 {
		t.Fatalf("only bearer should heal: %v", targetHP(t, done))
	}
	found := false
	for _, p := range done.FinalSnapshot.Combatants[0].Providers {
		if p.DefinitionRef == "shield:spell" {
			found = true
		}
	}
	if !found {
		t.Fatal("unrelated shield must stay active")
	}
}

func TestSkillHitMissingNumericInputsAreNotZero(t *testing.T) {
	for _, where := range []string{"participation", "comparison", "amount"} {
		candidate := damageCand("d", "e", "r", "", 0)
		missing := model.GenericFormulaExpr{Op: "read", Path: "source.attr.missing.resolved"}
		switch where {
		case "participation":
			candidate.ParticipationCondition = &missing
		case "comparison":
			candidate.EventValueConditions[0].Value = missing
		case "amount":
			candidate.Operations[0].Amount = &missing
		}
		c, r := withSkillHit(t, []model.SkillHitCandidate{candidate}, nil, nil, []model.DriverEntry{hitEntry("h", 0, 0)},
			[]model.SkillUseFact{{UseKey: "use", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}}, []model.SkillHitFact{{DriverEntryKey: "h", UseRef: hitUse("use")}}, 50)
		if err := runSkillHitErr(t, c, r); err.Path == "" {
			t.Fatalf("missing %s input needs its formula path", where)
		}
	}
}

func TestSkillHitDynamicBlockedOnlyComparisonFailsBeforeShieldDecision(t *testing.T) {
	candidate := damageCand("d", "e", "r", model.SpellShieldScopeSkill, 0)
	candidate.EventValueConditions[0].Value = model.GenericFormulaExpr{Op: "read", Path: "ability.param.branch"}
	c, r := withSkillHit(t, []model.SkillHitCandidate{candidate}, nil, nil, []model.DriverEntry{hitEntry("h", 0, 0)},
		[]model.SkillUseFact{{UseKey: "use", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}}, []model.SkillHitFact{{DriverEntryKey: "h", UseRef: hitUse("use")}}, 50)
	runSkillHitErr(t, c, r)
}

func TestSkillHitRejectsUnimplementedStatusRemovalAndIgnoredTarget(t *testing.T) {
	candidate := stunCand("s", "e", "r", model.SpellShieldScopeResult)
	candidate.Semantic.StatusOperation = model.StatusOperationRemove
	candidate.Operations = []model.OperationDefinition{{Operation: "refresh_provider", Target: "source", ProviderRef: "champion:source_demo"}}
	c, _ := withSkillHit(t, []model.SkillHitCandidate{candidate}, []model.ProviderDefinition{stunProvider()}, nil, nil, nil, nil, 50)
	if got := compile.CompileGeneric(c); got.OK {
		t.Fatal("REMOVE cannot refresh a different target")
	}
	c, _ = withSkillHit(t, []model.SkillHitCandidate{damageCand("d", "e", "r", "", 0)}, nil, nil, nil, nil, nil, 50)
	c.SharedProviders[0].Abilities[0].Operations[0].Target = "source"
	if got := compile.CompileGeneric(c); got.OK {
		t.Fatal("resolve target must be the actual driver target")
	}
}

func TestSkillHitSlowIdentityMustMatchTheActualContribution(t *testing.T) {
	duration := hitConst(1000)
	provider := model.ProviderDefinition{ProviderKey: "status:slow", Kind: "status", StableID: "slow", Lifecycle: &model.ProviderLifecycle{
		DurationMs: &duration, MaxStacks: 1, RefreshPolicy: model.RefreshPolicyReplace, InstanceScope: model.InstanceScopeSourceTarget},
		StatusContributions: []model.StatusContributionDefinition{{ResultRef: "r", StatusKey: "real_slow", StatusKind: model.StatusKindMovementSlow, Strength: hitConst(0.3)}}}
	candidate := stunCand("s", "e", "r", model.SpellShieldScopeResult)
	candidate.Semantic.StatusKind = model.StatusKindMovementSlow
	candidate.Semantic.StatusKey = "different_slow"
	candidate.Operations[0].ProviderDefinitionRef = "status:slow"
	c, _ := withSkillHit(t, []model.SkillHitCandidate{candidate}, []model.ProviderDefinition{provider}, nil, nil, nil, nil, 50)
	if got := compile.CompileGeneric(c); got.OK {
		t.Fatal("statusKey must match the provider's actual slow contribution")
	}
}
