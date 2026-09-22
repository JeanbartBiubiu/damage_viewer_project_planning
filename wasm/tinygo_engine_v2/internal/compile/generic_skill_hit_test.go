package compile

import (
	"strings"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func skillHitTypes(req *model.CompileRequest) {
	add := func(key, domain string) {
		for _, t := range req.TypeCatalog.Types {
			if t.Key == key {
				return
			}
		}
		req.TypeCatalog.Types = append(req.TypeCatalog.Types, model.TypeCatalogEntry{Key: key, Domain: domain})
	}
	add(model.EventTypeSkillHit, "event")
	add(model.EventTypeSpellShieldBlocked, "event")
	add(model.ProviderTypeSpellShield, "provider")
	add(model.ClosedStatusKindProviderType[model.StatusKindStun], "provider")
	add("event/damage_dealt", "event")
}

func constN(v float64) model.GenericFormulaExpr {
	return model.GenericFormulaExpr{Op: "const", Value: model.Float64Ptr(v)}
}

func ptrScope(v string) *string { return &v }

func damageCandidate(scope *string) model.SkillHitCandidate {
	return model.SkillHitCandidate{
		CandidateKey:        "dmg",
		EffectOccurrenceKey: "occ-hit",
		EffectKey:           "effect-hit",
		ResultKey:           "result-dmg",
		Semantic: model.SkillHitSemantic{
			ResultType: model.SkillHitResultDamage,
			Target:     model.SkillHitTargetTARGET,
			Moment:     model.SkillHitMomentInstant,
		},
		SpellShieldBlockScope: scope,
		EventValueConditions: []model.SkillHitEventValueCondition{{
			Key: model.SkillHitValueBlocked, Comparator: "eq", Value: constN(0),
		}},
		Operations: []model.OperationDefinition{{
			Operation: "damage", Target: "target", DamageType: "damage/physical", Amount: &model.GenericFormulaExpr{Op: "const", Value: model.Float64Ptr(100)},
		}},
	}
}

func hitAbility(cands ...model.SkillHitCandidate) model.AbilityDefinition {
	return model.AbilityDefinition{
		AbilityKey: "skill_hit",
		Kind:       "active",
		Operations: []model.OperationDefinition{{
			Operation: model.OperationKindResolveSkillHit,
			Target:    "target",
			SkillHit:  &model.SkillHitDefinition{SkillKey: "author:q", Candidates: cands},
		}},
	}
}

func TestCompileResolveSkillHitAcceptsPlan(t *testing.T) {
	req := minimalValidCompileRequest()
	skillHitTypes(&req)
	req.SharedProviders[0].Abilities = []model.AbilityDefinition{hitAbility(damageCandidate(ptrScope(model.SpellShieldScopeSkill)))}
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile: %+v", result.Result.Errors)
	}
	if !result.Session.Abilities[0].HasSkillHit || result.Session.Abilities[0].OperationCount != 1 {
		t.Fatalf("ability hit flags %+v count=%d", result.Session.Abilities[0], result.Session.Abilities[0].OperationCount)
	}
}

func TestCompileResolveSkillHitRejectsMixedOperations(t *testing.T) {
	req := minimalValidCompileRequest()
	skillHitTypes(&req)
	ability := hitAbility(damageCandidate(ptrScope(model.SpellShieldScopeSkill)))
	ability.Operations = append(ability.Operations, model.OperationDefinition{Operation: "damage", Target: "target", DamageType: "damage/physical", Amount: &model.GenericFormulaExpr{Op: "const", Value: model.Float64Ptr(1)}})
	req.SharedProviders[0].Abilities = []model.AbilityDefinition{ability}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected mixed resolve_skill_hit to fail")
	}
}

func TestCompileRejectsForgedSkillHitEmit(t *testing.T) {
	req := minimalValidCompileRequest()
	skillHitTypes(&req)
	req.SharedProviders[0].Abilities = []model.AbilityDefinition{{
		AbilityKey: "forge", Kind: "active",
		Operations: []model.OperationDefinition{{Operation: "emit_event", Target: "target", EventType: model.EventTypeSkillHit}},
	}}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected forged emit to fail")
	}
}

func TestCompileRejectsBlockedOnlyInbound(t *testing.T) {
	req := minimalValidCompileRequest()
	skillHitTypes(&req)
	cand := damageCandidate(ptrScope(model.SpellShieldScopeSkill))
	cand.EventValueConditions = []model.SkillHitEventValueCondition{{
		Key: model.SkillHitValueBlocked, Comparator: "eq", Value: constN(1),
	}}
	req.SharedProviders[0].Abilities = []model.AbilityDefinition{hitAbility(cand)}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected blocked=1-only inbound to fail")
	}
}

func TestCompileSpellShieldScopeMatrix(t *testing.T) {
	req := minimalValidCompileRequest()
	skillHitTypes(&req)
	cand := damageCandidate(ptrScope(model.SpellShieldScopeDamageInstance))
	cand.Semantic.ResultType = model.SkillHitResultAttributeChange
	cand.Operations = []model.OperationDefinition{{
		Operation: "attribute_change", Target: "target", AttributeKey: "attack_damage", ValuePolicy: "add",
		Amount: &model.GenericFormulaExpr{Op: "const", Value: model.Float64Ptr(1)},
	}}
	req.SharedProviders[0].Abilities = []model.AbilityDefinition{hitAbility(cand)}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("DAMAGE_INSTANCE on ATTRIBUTE_CHANGE must fail")
	}
}

func TestCompileProviderRefFromEventRequiresBlockedEvent(t *testing.T) {
	req := minimalValidCompileRequest()
	skillHitTypes(&req)
	req.SharedProviders = append(req.SharedProviders, model.ProviderDefinition{
		ProviderKey: "shield:spell", Kind: "status", StableID: "ss",
		Types: []string{model.ProviderTypeSpellShield},
		Listeners: []model.ListenerDefinition{{
			ListenerKey:  "consume",
			EventMatcher: model.TypeMatcher{All: []string{"event/damage_dealt"}},
			Operations: []model.OperationDefinition{{
				Operation: "expire_provider", Target: "self", ProviderRefFromEvent: true,
			}},
		}},
	})
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("providerRefFromEvent without spell_shield_blocked must fail")
	}
}

func TestCompileProviderRefFromEventAcceptsShieldListener(t *testing.T) {
	req := minimalValidCompileRequest()
	skillHitTypes(&req)
	req.SharedProviders = append(req.SharedProviders, model.ProviderDefinition{
		ProviderKey: "shield:spell", Kind: "status", StableID: "ss",
		Types: []string{model.ProviderTypeSpellShield},
		Listeners: []model.ListenerDefinition{{
			ListenerKey:  "consume",
			EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSpellShieldBlocked}},
			Operations: []model.OperationDefinition{{
				Operation: "expire_provider", Target: "self", ProviderRefFromEvent: true,
			}},
		}},
	})
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile: %+v", result.Result.Errors)
	}
}

func TestCompileHalfThresholdAndNegativeAreLegal(t *testing.T) {
	req := minimalValidCompileRequest()
	skillHitTypes(&req)
	cand := damageCandidate(ptrScope(model.SpellShieldScopeSkill))
	cand.EventValueConditions = []model.SkillHitEventValueCondition{
		{Key: model.SkillHitValueBlocked, Comparator: "eq", Value: constN(0)},
		{Key: model.SkillHitValueFirstContact, Comparator: "gt", Value: constN(-1)},
		{Key: model.SkillHitValueBlocked, Comparator: "lt", Value: constN(0.5)},
	}
	req.SharedProviders[0].Abilities = []model.AbilityDefinition{hitAbility(cand)}
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("0.5 and negative thresholds should compile: %+v", result.Result.Errors)
	}
}

func TestCompileStatusMustMatchProviderIdentity(t *testing.T) {
	req := minimalValidCompileRequest()
	skillHitTypes(&req)
	req.SharedProviders = append(req.SharedProviders, model.ProviderDefinition{
		ProviderKey: "status:stun", Kind: "status", StableID: "stun",
		Types: []string{model.ClosedStatusKindProviderType[model.StatusKindStun]},
	})
	cand := model.SkillHitCandidate{
		CandidateKey: "stun", EffectOccurrenceKey: "occ", EffectKey: "e", ResultKey: "r",
		Semantic: model.SkillHitSemantic{
			ResultType: model.SkillHitResultStatusOperation, Target: model.SkillHitTargetTARGET,
			Moment: model.SkillHitMomentInstant, StatusOperation: model.StatusOperationApply,
			StatusKey: "stun_q", StatusKind: model.StatusKindRoot,
		},
		SpellShieldBlockScope: ptrScope(model.SpellShieldScopeResult),
		Operations:            []model.OperationDefinition{{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: "status:stun"}},
	}
	req.SharedProviders[0].Abilities = []model.AbilityDefinition{hitAbility(cand)}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("stun provider cannot satisfy root semantic")
	}
}

func TestCompileRejectsNumericShieldAsSpellShield(t *testing.T) {
	req := minimalValidCompileRequest()
	skillHitTypes(&req)
	cand := model.SkillHitCandidate{
		CandidateKey: "sh", EffectOccurrenceKey: "occ", EffectKey: "e", ResultKey: "r",
		Semantic: model.SkillHitSemantic{
			ResultType: model.SkillHitResultSpellShield, Target: model.SkillHitTargetTARGET, Moment: model.SkillHitMomentPersistent,
		},
		Operations: []model.OperationDefinition{{Operation: "shield", Target: "target", Amount: &model.GenericFormulaExpr{Op: "const", Value: model.Float64Ptr(20)}}},
	}
	req.SharedProviders[0].Abilities = []model.AbilityDefinition{hitAbility(cand)}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("numeric shield must not compile as SPELL_SHIELD")
	}
	joined := ""
	for _, err := range result.Result.Errors {
		joined += err.Message
	}
	if !strings.Contains(joined, "spell_shield") && !strings.Contains(strings.ToLower(joined), "shield") {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
}
