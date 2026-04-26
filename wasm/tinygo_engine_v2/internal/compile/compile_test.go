// 本文件验证 bundle 编译阶段的短 ID 生成、默认值填充和 fail-fast 引用校验。
package compile

import (
	"strings"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestBundleCompilesV2AttributeAndResourceIndexes(t *testing.T) {
	result := Bundle(model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		Attributes: []model.AttributeDefinitionV2{
			{ID: "attack_damage", DefaultBase: 10},
		},
		Resources: []model.ResourceDefinitionV2{
			{ID: "mana", DefaultCurrent: 40, DefaultMax: 100},
		},
		Actors: []model.ActorTemplateV2{
			{
				ID: "mage",
				Attributes: map[string]model.AttributeValueV2{
					"attack_damage": {Base: 25},
				},
				Resources: map[string]model.ResourceValueV2{
					"mana": {Current: 80, Max: 100},
				},
			},
		},
	})
	if len(result.Problems) != 0 {
		t.Fatalf("compile problems: %v", result.Problems)
	}
	if got := result.Bundle.Actors[0].Attributes[0].Base; got != 25 {
		t.Fatalf("actor attr base %.2f, want 25", got)
	}
	if got := result.Bundle.Actors[0].Resources[0].Current; got != 80 {
		t.Fatalf("actor mana %.2f, want 80", got)
	}
}

func TestBundleFailsFastOnUnknownAttribute(t *testing.T) {
	result := Bundle(model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		Attributes: []model.AttributeDefinitionV2{
			{ID: "attack_damage"},
		},
		Actors: []model.ActorTemplateV2{
			{ID: "fighter", Attributes: map[string]model.AttributeValueV2{"missing": {Base: 1}}},
		},
	})
	if len(result.Problems) == 0 {
		t.Fatal("expected unknown attribute problem")
	}
}

func TestBundleFailsFastOnUnknownResourceFormula(t *testing.T) {
	result := Bundle(model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		Attributes: []model.AttributeDefinitionV2{
			{ID: "attack_damage"},
		},
		Formulas: []model.FormulaDefinitionV2{
			{ID: "mana_now", Op: "resource", Resource: "mana"},
		},
	})
	if len(result.Problems) == 0 {
		t.Fatal("expected unknown resource problem")
	}
}

func TestCompileStatusActionControlRule(t *testing.T) {
	result := Bundle(model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		Actions: []model.ActionTemplateV2{
			{ID: "basic_attack", Classifier: model.ClassifierV2{Types: []string{"action/basic_attack"}}},
			{ID: "fireball", Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}, Tags: []string{"skill_tag/fire"}}},
		},
		Statuses: []model.StatusTemplateV2{
			{ID: "silence", Kind: "control", Classifier: model.ClassifierV2{Types: []string{"status/silence"}}},
		},
		StatusActionControlRules: []model.StatusActionControlRuleV2{
			{
				ID:          "silence_forbid",
				RuleKind:    "forbid",
				StatusTypes: model.TypeMatcherV2{Any: []string{"status/silence"}},
				ActionTypes: model.TypeMatcherV2{Any: []string{"action/cast_skill"}},
				Priority:    80,
			},
		},
	})
	if len(result.Problems) != 0 {
		t.Fatalf("compile problems: %v", result.Problems)
	}
	if got := len(result.Bundle.ControlRules.Rules); got != 1 {
		t.Fatalf("rule count = %d, want 1", got)
	}
	rule := result.Bundle.ControlRules.Rules[0]
	if rule.Kind != ControlRuleForbid || rule.ID != "silence_forbid" || rule.Priority != 80 {
		t.Fatalf("compiled rule = %+v", rule)
	}
	if !rule.StatusMatcher.Match(result.Bundle.Statuses[0].TypeSet) {
		t.Fatal("rule should match silence status")
	}
	if !rule.ActionMatcher.Match(result.Bundle.Actions[1].TypeSet) {
		t.Fatal("rule should match cast skill action")
	}
	if rule.ActionMatcher.Match(result.Bundle.Actions[0].TypeSet) {
		t.Fatal("rule should not match basic attack")
	}
}

func TestCompileRejectsInvalidRuleKindAndUnknownType(t *testing.T) {
	result := Bundle(model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		Actions:       []model.ActionTemplateV2{{ID: "fireball", Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}}}},
		Statuses:      []model.StatusTemplateV2{{ID: "silence", Kind: "control", Classifier: model.ClassifierV2{Types: []string{"status/silence"}}}},
		StatusActionControlRules: []model.StatusActionControlRuleV2{
			{ID: "bad_kind", RuleKind: "ban", StatusTypes: model.TypeMatcherV2{Any: []string{"status/silence"}}, ActionTypes: model.TypeMatcherV2{Any: []string{"action/cast_skill"}}},
			{ID: "unknown_type", RuleKind: "forbid", StatusTypes: model.TypeMatcherV2{Any: []string{"status/missing"}}, ActionTypes: model.TypeMatcherV2{Any: []string{"action/cast_skill"}}},
		},
	})
	if !hasProblem(result.Problems, "unsupported status action control rule kind") {
		t.Fatalf("missing invalid kind problem: %v", result.Problems)
	}
	if !hasProblem(result.Problems, "unknown type") {
		t.Fatalf("missing unknown type problem: %v", result.Problems)
	}
}

func TestCompileRejectsInvalidInterruptPhase(t *testing.T) {
	result := Bundle(model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		Actions:       []model.ActionTemplateV2{{ID: "fireball", Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}}}},
		Statuses:      []model.StatusTemplateV2{{ID: "silence", Kind: "control", Classifier: model.ClassifierV2{Types: []string{"status/silence"}}}},
		StatusActionControlRules: []model.StatusActionControlRuleV2{
			{ID: "forbid_with_phase", RuleKind: "forbid", StatusTypes: model.TypeMatcherV2{Any: []string{"status/silence"}}, ActionTypes: model.TypeMatcherV2{Any: []string{"action/cast_skill"}}, InterruptPhaseTypes: model.TypeMatcherV2{Any: []string{"exec_phase/cast"}}},
			{ID: "interrupt_without_phase", RuleKind: "interrupt", StatusTypes: model.TypeMatcherV2{Any: []string{"status/silence"}}, ActionTypes: model.TypeMatcherV2{Any: []string{"action/cast_skill"}}},
		},
	})
	if !hasProblem(result.Problems, "forbid rule declares interrupt phases") {
		t.Fatalf("missing forbid phase problem: %v", result.Problems)
	}
	if !hasProblem(result.Problems, "interrupt rule missing interrupt phases") {
		t.Fatalf("missing interrupt phase problem: %v", result.Problems)
	}
}

func TestLegacyBlocksActionsGeneratesForbidRule(t *testing.T) {
	result := Bundle(model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		Actions:       []model.ActionTemplateV2{{ID: "basic_attack"}},
		Statuses:      []model.StatusTemplateV2{{ID: "stun", Kind: "control", BlocksActions: true, RetryOnRelease: true}},
	})
	if len(result.Problems) != 0 {
		t.Fatalf("compile problems: %v", result.Problems)
	}
	if got := len(result.Bundle.ControlRules.Rules); got != 1 {
		t.Fatalf("rule count = %d, want 1", got)
	}
	rule := result.Bundle.ControlRules.Rules[0]
	if rule.ID != "legacy_stun_block_all" || !rule.RetryOnRelease {
		t.Fatalf("legacy rule = %+v", rule)
	}
	if !rule.StatusMatcher.Match(result.Bundle.Statuses[0].TypeSet) || !rule.ActionMatcher.Match(result.Bundle.Actions[0].TypeSet) {
		t.Fatal("legacy rule should match stun and basic attack")
	}
}

func TestBundleCompilesResourceCost(t *testing.T) {
	result := Bundle(model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		Resources:     []model.ResourceDefinitionV2{{ID: "mana", DefaultCurrent: 100, DefaultMax: 100}},
		Actions:       []model.ActionTemplateV2{{ID: "fireball", ResourceCost: []model.ResourceCostV2{{ResourceID: "mana", Amount: 40}}}},
	})
	if len(result.Problems) != 0 {
		t.Fatalf("compile problems: %v", result.Problems)
	}
	if got := len(result.Bundle.Actions[0].Costs); got != 1 {
		t.Fatalf("cost count = %d, want 1", got)
	}
	if result.Bundle.Actions[0].Costs[0].Resource != 0 || result.Bundle.Actions[0].Costs[0].Amount != 40 {
		t.Fatalf("compiled cost = %+v", result.Bundle.Actions[0].Costs[0])
	}
}

func TestBundleRejectsBadResourceCost(t *testing.T) {
	result := Bundle(model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		Resources:     []model.ResourceDefinitionV2{{ID: "mana"}},
		Actions: []model.ActionTemplateV2{
			{ID: "unknown", ResourceCost: []model.ResourceCostV2{{ResourceID: "energy", Amount: 1}}},
			{ID: "negative", ResourceCost: []model.ResourceCostV2{{ResourceID: "mana", Amount: -1}}},
		},
	})
	if !hasProblem(result.Problems, "unknown action resource cost") {
		t.Fatalf("missing unknown resource cost problem: %v", result.Problems)
	}
	if !hasProblem(result.Problems, "invalid action resource cost amount") {
		t.Fatalf("missing invalid resource cost problem: %v", result.Problems)
	}
}

func TestBundleIndexesUseCompiledSlicePositions(t *testing.T) {
	result := Bundle(model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		Attributes: []model.AttributeDefinitionV2{
			{ID: ""},
			{ID: "attack_damage", DefaultBase: 10},
		},
		Resources: []model.ResourceDefinitionV2{
			{ID: ""},
			{ID: "mana", DefaultCurrent: 40, DefaultMax: 100},
		},
		Actors: []model.ActorTemplateV2{{
			ID:         "mage",
			Attributes: map[string]model.AttributeValueV2{"attack_damage": {Base: 25}},
			Resources:  map[string]model.ResourceValueV2{"mana": {Current: 80, Max: 100}},
		}},
	})
	if result.Bundle.AttrIndex["attack_damage"] != 0 || result.Bundle.ResourceIndex["mana"] != 0 {
		t.Fatalf("indexes = attr %d resource %d, want both 0", result.Bundle.AttrIndex["attack_damage"], result.Bundle.ResourceIndex["mana"])
	}
	if got := result.Bundle.Actors[0].Attributes[0].Base; got != 25 {
		t.Fatalf("actor attr base %.2f, want 25", got)
	}
	if got := result.Bundle.Actors[0].Resources[0].Current; got != 80 {
		t.Fatalf("actor mana %.2f, want 80", got)
	}
}

func TestBundleRejectsDuplicateEntityIDs(t *testing.T) {
	result := Bundle(model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		Actions:       []model.ActionTemplateV2{{ID: "a"}, {ID: "a"}},
		Statuses:      []model.StatusTemplateV2{{ID: "s"}, {ID: "s"}},
		Actors:        []model.ActorTemplateV2{{ID: "actor"}, {ID: "actor"}},
	})
	for _, want := range []string{"duplicate action", "duplicate status", "duplicate actor"} {
		if !hasProblem(result.Problems, want) {
			t.Fatalf("missing %q problem: %v", want, result.Problems)
		}
	}
}

func hasProblem(problems []string, needle string) bool {
	for _, problem := range problems {
		if strings.Contains(problem, needle) {
			return true
		}
	}
	return false
}
