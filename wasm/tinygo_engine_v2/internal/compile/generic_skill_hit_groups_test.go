package compile

import (
	"encoding/json"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func groupedHitRequest() model.CompileRequest {
	req := minimalValidCompileRequest()
	p6Types(&req)
	candidates := make([]model.SkillHitCandidate, 3)
	for i, key := range []string{"first", "second", "third"} {
		candidate := damageCandidate(nil)
		candidate.CandidateKey, candidate.ResultKey = key, key
		candidate.EventValueConditions = nil
		candidates[i] = candidate
	}
	ability := hitAbility(candidates...)
	ability.Operations[0].SkillHit.RuleGroups = []model.SkillHitRuleGroup{{RuleKey: "rule", CandidateKeys: []string{"first", "second"}, OncePerUse: &model.OncePerUseLimit{GroupKey: "shared", Scope: model.OncePerUseScopeProviderTarget}}}
	req.SharedProviders[0].Abilities = []model.AbilityDefinition{ability}
	return req
}

func TestCompileSkillHitRuleGroupRejectsIncompleteIdentityAndMembership(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(*model.CompileRequest, *model.SkillHitDefinition)
	}{
		{"blank rule", func(_ *model.CompileRequest, h *model.SkillHitDefinition) { h.RuleGroups[0].RuleKey = " " }},
		{"missing limit", func(_ *model.CompileRequest, h *model.SkillHitDefinition) { h.RuleGroups[0].OncePerUse = nil }},
		{"bad key", func(_ *model.CompileRequest, h *model.SkillHitDefinition) {
			h.RuleGroups[0].OncePerUse.GroupKey = "Not_a_key"
		}},
		{"bad scope", func(_ *model.CompileRequest, h *model.SkillHitDefinition) {
			h.RuleGroups[0].OncePerUse.Scope = "target"
		}},
		{"empty", func(_ *model.CompileRequest, h *model.SkillHitDefinition) { h.RuleGroups[0].CandidateKeys = nil }},
		{"unknown", func(_ *model.CompileRequest, h *model.SkillHitDefinition) {
			h.RuleGroups[0].CandidateKeys = []string{"first", "unknown"}
		}},
		{"duplicate", func(_ *model.CompileRequest, h *model.SkillHitDefinition) {
			h.RuleGroups[0].CandidateKeys = []string{"first", "first"}
		}},
		{"reversed", func(_ *model.CompileRequest, h *model.SkillHitDefinition) {
			h.RuleGroups[0].CandidateKeys = []string{"second", "first"}
		}},
		{"gap", func(_ *model.CompileRequest, h *model.SkillHitDefinition) {
			h.RuleGroups[0].CandidateKeys = []string{"first", "third"}
		}},
		{"overlap", func(_ *model.CompileRequest, h *model.SkillHitDefinition) {
			h.RuleGroups = append(h.RuleGroups, model.SkillHitRuleGroup{RuleKey: "other", CandidateKeys: []string{"second", "third"}, OncePerUse: h.RuleGroups[0].OncePerUse})
		}},
		{"duplicate rule", func(_ *model.CompileRequest, h *model.SkillHitDefinition) {
			h.RuleGroups = append(h.RuleGroups, model.SkillHitRuleGroup{RuleKey: "rule", CandidateKeys: []string{"third"}, OncePerUse: h.RuleGroups[0].OncePerUse})
		}},
		{"dynamic parent", func(r *model.CompileRequest, _ *model.SkillHitDefinition) {
			duration := constN(1000)
			r.SharedProviders[0].Lifecycle = &model.ProviderLifecycle{DurationMs: &duration, MaxStacks: 1, RefreshPolicy: model.RefreshPolicyReplace}
		}},
		{"unmounted parent", func(r *model.CompileRequest, _ *model.SkillHitDefinition) { r.Combatants[0].Providers = nil }},
		{"basic attack", func(r *model.CompileRequest, _ *model.SkillHitDefinition) {
			r.SharedProviders[0].Abilities[0].Types = []string{model.AbilityTypeBasicAttack}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := groupedHitRequest()
			hit := req.SharedProviders[0].Abilities[0].Operations[0].SkillHit
			tc.mutate(&req, hit)
			result := CompileGeneric(req)
			if result.OK {
				t.Fatal("accepted invalid group", tc.name)
			}
		})
	}
}

func TestCompileSkillHitRuleGroupRequiresOneDirectPredicate(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(*model.SkillHitDefinition)
	}{
		{"participation", func(h *model.SkillHitDefinition) { one := constN(1); h.Candidates[1].ParticipationCondition = &one }},
		{"participation provider", func(h *model.SkillHitDefinition) {
			one := constN(1)
			for i := 0; i < 2; i++ {
				h.Candidates[i].ParticipationCondition = &one
			}
			h.Candidates[1].ParticipationProviderRef = "foreign"
		}},
		{"different predicate value", func(h *model.SkillHitDefinition) {
			for i := 0; i < 2; i++ {
				h.Candidates[i].EventValueConditions = []model.SkillHitEventValueCondition{{Key: model.SkillHitValueBlocked, Comparator: "eq", Value: constN(float64(i))}}
			}
		}},
		{"first contact", func(h *model.SkillHitDefinition) {
			for i := 0; i < 2; i++ {
				h.Candidates[i].EventValueConditions = []model.SkillHitEventValueCondition{{Key: model.SkillHitValueFirstContact, Comparator: "eq", Value: constN(1)}}
			}
		}},
		{"operation condition", func(h *model.SkillHitDefinition) { one := constN(1); h.Candidates[1].Operations[0].Condition = &one }},
		{"repeat", func(h *model.SkillHitDefinition) {
			h.Candidates[1].Operations = append(h.Candidates[1].Operations, model.OperationDefinition{Operation: model.OperationKindRepeat, RepeatCount: 1, RepeatScope: model.RepeatScopeCopyableOnHit})
		}},
		{"nested hit", func(h *model.SkillHitDefinition) {
			h.Candidates[1].Operations = append(h.Candidates[1].Operations, model.OperationDefinition{Operation: model.OperationKindResolveSkillHit, Target: "target", SkillHit: &model.SkillHitDefinition{SkillKey: "nested"}})
		}},
		{"indirect ability", func(h *model.SkillHitDefinition) {
			h.Candidates[1].Operations[0].Operation = "cast_ability"
			h.Candidates[1].Operations[0].AbilityRef = "source.provider[champion:source_demo].ability[skill_hit]"
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := groupedHitRequest()
			tc.mutate(req.SharedProviders[0].Abilities[0].Operations[0].SkillHit)
			if result := CompileGeneric(req); result.OK {
				t.Fatal("accepted invalid predicate or indirect operation")
			}
		})
	}
}

func TestCompileSkillHitRuleGroupUnifiesMountedScopeAndOutputBoundaries(t *testing.T) {
	for _, scope := range []string{model.OncePerUseScopeProviderTarget, model.OncePerUseScopeProvider} {
		req := groupedHitRequest()
		req.SharedProviders[0].Listeners = []model.ListenerDefinition{{ListenerKey: "shared_listener", EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit}}, OncePerUse: &model.OncePerUseLimit{GroupKey: "shared", Scope: scope}, Operations: []model.OperationDefinition{{Operation: "heal", Target: "self", Amount: &model.GenericFormulaExpr{Op: "const", Value: model.Float64Ptr(1)}}}}}
		result := CompileGeneric(req)
		if result.OK != (scope == model.OncePerUseScopeProviderTarget) {
			t.Fatal("listener/group scope mismatch", scope, result.Result.Errors)
		}
	}
	req := groupedHitRequest()
	hit := req.SharedProviders[0].Abilities[0].Operations[0].SkillHit
	hit.RuleGroups = append(hit.RuleGroups, model.SkillHitRuleGroup{RuleKey: "another", CandidateKeys: []string{"third"}, OncePerUse: &model.OncePerUseLimit{GroupKey: "shared", Scope: model.OncePerUseScopeProvider}})
	if CompileGeneric(req).OK {
		t.Fatal("two rules used incompatible scopes for the same mounted group")
	}
	req = groupedHitRequest()
	hit = req.SharedProviders[0].Abilities[0].Operations[0].SkillHit
	hit.Candidates[0].Operations[0].OutputRef = "damage"
	hit.Candidates[1].Operations[0].Amount = &model.GenericFormulaExpr{Op: "read", Path: "operation.output.damage.POST_DEFENSE_DAMAGE"}
	if CompileGeneric(req).OK {
		t.Fatal("group merged independent candidate output units")
	}
	for _, raw := range []string{`{"skillKey":"s","candidates":[]}`, `{"skillKey":"s","candidates":[],"ruleGroups":[]}`, `{"skillKey":"s","candidates":[],"ruleGroups":null}`} {
		var decoded model.SkillHitDefinition
		if err := json.Unmarshal([]byte(raw), &decoded); err != nil || len(decoded.RuleGroups) != 0 {
			t.Fatal("old empty-group decoding changed", err, decoded)
		}
	}
	req = groupedHitRequest()
	req.SharedProviders[0].Abilities[0].Operations[0].SkillHit.RuleGroups = nil
	if result := CompileGeneric(req); !result.OK {
		t.Fatal("old no-group hit rejected", result.Result.Errors)
	}
}

func TestCompileSkillHitRuleGroupRejectsHiddenFirstContact(t *testing.T) {
	req := groupedHitRequest()
	hit := req.SharedProviders[0].Abilities[0].Operations[0].SkillHit
	condition := model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{constN(1), constN(1), {Op: "read", Path: model.FormulaPathSkillHitFirstContact}}}
	for i := 0; i < 2; i++ {
		hit.Candidates[i].ParticipationCondition = &condition
	}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("unused first-contact branch escaped qualification")
	}
	found := false
	for _, issue := range result.Result.Errors {
		if strings.Contains(issue.Path, "participationCondition") {
			found = true
		}
	}
	if !found {
		t.Fatal(result.Result.Errors)
	}
}
