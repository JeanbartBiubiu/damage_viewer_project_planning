package compile

import (
	"strings"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func p6Types(req *model.CompileRequest) {
	skillHitTypes(req)
	add := func(key, domain string) {
		for _, t := range req.TypeCatalog.Types {
			if t.Key == key {
				return
			}
		}
		req.TypeCatalog.Types = append(req.TypeCatalog.Types, model.TypeCatalogEntry{Key: key, Domain: domain})
	}
	add(model.AbilityTypeBasicAttack, "ability")
	add(model.EventTypeBasicAttackHit, "event")
	add(model.EventTypeBasicAttackStart, "event")
	add("event/source_owner", "event")
	add("state_scope/provider", "state_scope")
}

func p6Const(v float64) model.GenericFormulaExpr {
	return model.GenericFormulaExpr{Op: "const", Value: model.Float64Ptr(v)}
}

func TestCompileOncePerUseRejectsAbilityRefAndOpCondition(t *testing.T) {
	req := minimalValidCompileRequest()
	p6Types(&req)
	one := 1.0
	req.SharedProviders[0].Listeners = []model.ListenerDefinition{{
		ListenerKey:  "once",
		EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit, "event/source_owner"}},
		AbilityRef:   "source.provider[champion:source_demo].ability[basic_attack]",
		MaxTriggersPerEvent: 2,
		OncePerUse:   &model.OncePerUseLimit{GroupKey: "g", Scope: model.OncePerUseScopeProvider},
		Operations: []model.OperationDefinition{{
			Operation: "damage", Target: "target", DamageType: "damage/physical", Amount: &model.GenericFormulaExpr{Op: "const", Value: &one},
			Condition: &model.GenericFormulaExpr{Op: "const", Value: &one},
		}},
	}}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected oncePerUse compile failure")
	}
}

func TestCompileListenerConditionRejectsFirstContactAndOutput(t *testing.T) {
	req := minimalValidCompileRequest()
	p6Types(&req)
	req.SharedProviders[0].Listeners = []model.ListenerDefinition{{
		ListenerKey:  "cond",
		EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit}},
		Condition:    &model.GenericFormulaExpr{Op: "read", Path: model.FormulaPathSkillHitFirstContact},
		Operations: []model.OperationDefinition{{
			Operation: "heal", Target: "self", Amount: &model.GenericFormulaExpr{Op: "read", Path: "operation.output.hit.POST_DEFENSE_DAMAGE"},
		}},
	}}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected listener.condition compile failure")
	}
}

func TestCompileOutputRefRejectsDuplicateForwardAndNonDamage(t *testing.T) {
	req := minimalValidCompileRequest()
	p6Types(&req)
	amt := p6Const(10)
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{Operation: "heal", Target: "self", Amount: &amt, OutputRef: "hit"},
		{Operation: "damage", Target: "target", DamageType: "damage/physical", Amount: &amt, OutputRef: "hit.bad"},
		{Operation: "damage", Target: "target", DamageType: "damage/physical", Amount: &model.GenericFormulaExpr{Op: "read", Path: "operation.output.later.POST_DEFENSE_DAMAGE"}, OutputRef: "hit"},
		{Operation: "damage", Target: "target", DamageType: "damage/physical", Amount: &amt, OutputRef: "later"},
	}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected outputRef compile failure")
	}
}

func TestCompileRejectsForgedBasicAttackEvents(t *testing.T) {
	for _, eventType := range []string{model.EventTypeBasicAttackHit, model.EventTypeBasicAttackStart} {
		req := minimalValidCompileRequest()
		p6Types(&req)
		req.SharedProviders[0].Abilities = []model.AbilityDefinition{{
			AbilityKey: "forge", Kind: "active",
			Operations: []model.OperationDefinition{{Operation: "emit_event", Target: "target", EventType: eventType}},
		}}
		result := CompileGeneric(req)
		if result.OK {
			t.Fatalf("expected forged %s to fail", eventType)
		}
	}
}

func TestCompileStartOnFirstWriteRequiresDuration(t *testing.T) {
	req := minimalValidCompileRequest()
	req.SharedProviders[0].InitialStateSchema = map[string]interface{}{
		"hits": map[string]interface{}{
			"defaultValue":  float64(0),
			"durationMs":    float64(0),
			"refreshPolicy": model.ProviderStateRefreshStartOnFirstWrite,
		},
	}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected start_on_first_write without duration to fail")
	}
}

func TestCompileOncePerUseGroupScopeConflict(t *testing.T) {
	req := minimalValidCompileRequest()
	p6Types(&req)
	one := 1.0
	heal := model.OperationDefinition{Operation: "heal", Target: "self", Amount: &model.GenericFormulaExpr{Op: "const", Value: &one}}
	req.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "a",
			EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit}},
			OncePerUse:   &model.OncePerUseLimit{GroupKey: "shared", Scope: model.OncePerUseScopeProvider},
			Operations:   []model.OperationDefinition{heal},
		},
		{
			ListenerKey:  "b",
			EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit}},
			OncePerUse:   &model.OncePerUseLimit{GroupKey: "shared", Scope: model.OncePerUseScopeProviderTarget},
			Operations:   []model.OperationDefinition{heal},
		},
	}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected oncePerUse scope conflict")
	}
}

func TestCompileBasicAttackRejectsFirstContactCandidate(t *testing.T) {
	req := minimalValidCompileRequest()
	p6Types(&req)
	cand := damageCandidate(nil)
	cand.EventValueConditions = []model.SkillHitEventValueCondition{
		{Key: model.SkillHitValueFirstContact, Comparator: "eq", Value: constN(1)},
	}
	ability := hitAbility(cand)
	ability.Types = []string{model.AbilityTypeBasicAttack}
	ability.SkillKey = "aa:test"
	req.SharedProviders[0].Abilities = []model.AbilityDefinition{ability}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected firstContact on basic_attack candidate to fail")
	}
}

func TestCompileOncePerUseRulesListenerRejected(t *testing.T) {
	req := minimalValidCompileRequest()
	p6Types(&req)
	one := 1.0
	req.Rules.Listeners = []model.ListenerDefinition{{
		ListenerKey:  "global",
		EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit}},
		OncePerUse:   &model.OncePerUseLimit{GroupKey: "g", Scope: model.OncePerUseScopeProvider},
		Operations:   []model.OperationDefinition{{Operation: "heal", Target: "self", Amount: &model.GenericFormulaExpr{Op: "const", Value: &one}}},
	}}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected global oncePerUse to fail")
	}
	found := false
	for _, err := range result.Result.Errors {
		if strings.Contains(err.Path, "oncePerUse") {
			found = true
		}
	}
	if !found {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
}
