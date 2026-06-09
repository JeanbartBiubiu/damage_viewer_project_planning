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

func TestBundleCompilesM2PanelFormulas(t *testing.T) {
	result := Bundle(model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		Attributes:    []model.AttributeDefinitionV2{{ID: "attack_damage"}},
		Resources:     []model.ResourceDefinitionV2{{ID: "mana", DefaultCurrent: 100, DefaultMax: 100}},
		Formulas: []model.FormulaDefinitionV2{
			{ID: "skill_level", Op: "input"},
			{ID: "five", Op: "const", Value: 5},
			{ID: "level_cost", Op: "mul", Left: "skill_level", Right: "five"},
			{ID: "level_damage", Op: "attr", Attr: "attack_damage"},
			{ID: "level_cooldown", Op: "mul", Left: "skill_level", Right: "five"},
		},
		Actions: []model.ActionTemplateV2{{
			ID:                "level_bolt",
			CooldownFormulaID: "level_cooldown",
			ResourceCost:      []model.ResourceCostV2{{ResourceID: "mana", FormulaID: "level_cost"}},
			PanelCosts:        []model.ActionPanelCostV2{{ResourceID: "mana", FormulaID: "level_cost"}},
			PanelEffects:      []model.ActionPanelEffectV2{{EffectIndex: 0, Kind: "deal_damage", FormulaID: "level_damage"}},
		}},
	})
	if len(result.Problems) != 0 {
		t.Fatalf("compile problems: %v", result.Problems)
	}
	action := result.Bundle.Actions[0]
	if !action.HasCooldownFormula || len(action.PanelCosts) != 1 || !action.PanelCosts[0].HasFormula || len(action.PanelEffects) != 1 || !action.PanelEffects[0].HasFormula {
		t.Fatalf("compiled M2 panel action = %+v", action)
	}
}

func TestBundleRejectsBadM2PanelFormula(t *testing.T) {
	result := Bundle(model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		Resources:     []model.ResourceDefinitionV2{{ID: "mana"}},
		Actions: []model.ActionTemplateV2{{
			ID:                "bad_panel",
			CooldownFormulaID: "missing_cooldown",
			PanelCosts:        []model.ActionPanelCostV2{{ResourceID: "mana", FormulaID: "missing_cost"}},
			PanelEffects:      []model.ActionPanelEffectV2{{EffectIndex: 0, Kind: "deal_damage", FormulaID: "missing_effect"}},
		}},
	})
	for _, want := range []string{"unknown action cooldown formula", "unknown action panel cost formula", "unknown action panel effect formula"} {
		if !hasProblem(result.Problems, want) {
			t.Fatalf("missing %q problem: %v", want, result.Problems)
		}
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

func TestBundleCompilesCoefficientBuckets(t *testing.T) {
	result := Bundle(model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		Attributes: []model.AttributeDefinitionV2{
			{ID: "ability_power"},
		},
		CoefficientBuckets: []model.CoefficientBucketV2{
			{
				BucketKey:        "ap_final_mult",
				ResolutionDomain: "attribute",
				StageKey:         "attribute/final_multiplier",
				TargetAttrKey:    "ability_power",
				AggregationMode:  "multiply",
				Name:             "AP Final Multiplier",
				EditorHint:       map[string]interface{}{"group": "attributes"},
				BucketConfig: model.CoefficientBucketConfigV2{
					Priority:      10,
					ValueUnit:     "factor",
					ClampMin:      0,
					HasClampMin:   true,
					EvidenceLabel: "ap_final",
				},
			},
			{
				BucketKey:        "incoming_damage",
				ResolutionDomain: "hp_change",
				StageKey:         "hp_change/incoming/pre_mitigation",
				AggregationMode:  "add",
				BucketConfig: model.CoefficientBucketConfigV2{
					ValueUnit:   "percent_delta",
					ClampMax:    0,
					HasClampMax: true,
				},
			},
		},
	})
	if len(result.Problems) != 0 {
		t.Fatalf("compile problems: %v", result.Problems)
	}
	if got := len(result.Bundle.CoefficientBuckets); got != 2 {
		t.Fatalf("bucket count = %d, want 2", got)
	}
	attrBucket := result.Bundle.CoefficientBuckets[0]
	if attrBucket.ID != 0 || attrBucket.BucketKey != "ap_final_mult" {
		t.Fatalf("attr bucket = %+v", attrBucket)
	}
	if attrBucket.ResolutionDomain != ResolutionDomainAttribute || attrBucket.StageKey != "attribute/final_multiplier" {
		t.Fatalf("attr bucket domain/stage = %+v", attrBucket)
	}
	if !attrBucket.HasTargetAttr || attrBucket.TargetAttr != 0 {
		t.Fatalf("attr bucket target = attr %d has=%v, want 0 true", attrBucket.TargetAttr, attrBucket.HasTargetAttr)
	}
	if attrBucket.AggregationMode != AggregationModeMultiply || attrBucket.Name != "AP Final Multiplier" {
		t.Fatalf("attr bucket mode/name = %+v", attrBucket)
	}
	if got := attrBucket.EditorHint["group"]; got != "attributes" {
		t.Fatalf("attr bucket editorHint = %+v", attrBucket.EditorHint)
	}
	if attrBucket.Config.Priority != 10 || attrBucket.Config.ValueUnit != "factor" ||
		!attrBucket.Config.HasClampMin || attrBucket.Config.ClampMin != 0 ||
		attrBucket.Config.EvidenceLabel != "ap_final" {
		t.Fatalf("attr bucket config = %+v", attrBucket.Config)
	}
	hpBucket := result.Bundle.CoefficientBuckets[1]
	if hpBucket.ID != 1 || hpBucket.ResolutionDomain != ResolutionDomainHPChange {
		t.Fatalf("hp bucket = %+v", hpBucket)
	}
	if hpBucket.HasTargetAttr || hpBucket.Config.ValueUnit != "percent_delta" ||
		!hpBucket.Config.HasClampMax || hpBucket.Config.ClampMax != 0 {
		t.Fatalf("hp bucket config = %+v", hpBucket)
	}
	if result.Bundle.CoefficientBucketIndex["ap_final_mult"] != 0 ||
		result.Bundle.CoefficientBucketIndex["incoming_damage"] != 1 {
		t.Fatalf("bucket index = %+v", result.Bundle.CoefficientBucketIndex)
	}
}

func TestBundleRejectsInvalidCoefficientBuckets(t *testing.T) {
	result := Bundle(model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		Attributes:    []model.AttributeDefinitionV2{{ID: "ability_power"}},
		CoefficientBuckets: []model.CoefficientBucketV2{
			{BucketKey: "bad_domain", ResolutionDomain: "damage", StageKey: "hp_change/incoming/pre_mitigation", AggregationMode: "add"},
			{BucketKey: "bad_mode", ResolutionDomain: "hp_change", StageKey: "hp_change/incoming/pre_mitigation", AggregationMode: "average"},
			{BucketKey: "dup", ResolutionDomain: "hp_change", StageKey: "hp_change/incoming/pre_mitigation", AggregationMode: "add"},
			{BucketKey: "dup", ResolutionDomain: "hp_change", StageKey: "hp_change/outgoing/pre_mitigation", AggregationMode: "multiply"},
			{BucketKey: "missing_attr", ResolutionDomain: "attribute", StageKey: "attribute/base_bonus", AggregationMode: "add"},
			{BucketKey: "unknown_attr", ResolutionDomain: "attribute", StageKey: "attribute/base_bonus", TargetAttrKey: "missing", AggregationMode: "add"},
			{BucketKey: "hp_with_attr", ResolutionDomain: "hp_change", StageKey: "hp_change/incoming/pre_mitigation", TargetAttrKey: "ability_power", AggregationMode: "add"},
		},
	})
	for _, want := range []string{
		"unsupported coefficient bucket resolution domain",
		"unsupported coefficient bucket aggregation mode",
		"duplicate coefficient bucket",
		"coefficient bucket missing target attr",
		"unknown coefficient bucket target attr",
		"coefficient bucket must not declare target attr for hp_change",
	} {
		if !hasProblem(result.Problems, want) {
			t.Fatalf("missing %q problem: %v", want, result.Problems)
		}
	}
}

func TestBundleCollectsAllCoefficientBucketProblems(t *testing.T) {
	result := Bundle(model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		CoefficientBuckets: []model.CoefficientBucketV2{
			{BucketKey: "", ResolutionDomain: "hp_change", StageKey: "hp_change/incoming/pre_mitigation", AggregationMode: "add"},
			{BucketKey: "bad_domain", ResolutionDomain: "unknown", StageKey: "hp_change/incoming/pre_mitigation", AggregationMode: "add"},
			{BucketKey: "missing_stage", ResolutionDomain: "hp_change", StageKey: "", AggregationMode: "add"},
			{BucketKey: "bad_stage", ResolutionDomain: "hp_change", StageKey: "incoming", AggregationMode: "add"},
			{BucketKey: "bad_mode", ResolutionDomain: "hp_change", StageKey: "hp_change/incoming/pre_mitigation", AggregationMode: "bad"},
			{
				BucketKey: "bad_value_unit", ResolutionDomain: "hp_change", StageKey: "hp_change/incoming/pre_mitigation", AggregationMode: "add",
				BucketConfig: model.CoefficientBucketConfigV2{ValueUnit: "percent"},
			},
			{
				BucketKey: "bad_clamp", ResolutionDomain: "hp_change", StageKey: "hp_change/incoming/pre_mitigation", AggregationMode: "add",
				BucketConfig: model.CoefficientBucketConfigV2{HasClampMin: true, ClampMin: 10, HasClampMax: true, ClampMax: 1},
			},
		},
	})
	for _, want := range []string{
		"coefficient bucket key is empty",
		"unsupported coefficient bucket resolution domain",
		"coefficient bucket stage key is empty",
		"unsupported coefficient bucket stage key",
		"unsupported coefficient bucket aggregation mode",
		"unsupported coefficient bucket value unit",
		"coefficient bucket clamp range invalid",
	} {
		if !hasProblem(result.Problems, want) {
			t.Fatalf("missing %q problem: %v", want, result.Problems)
		}
	}
}

func TestBundleRejectsInvalidCoefficientBucketStageForAttribute(t *testing.T) {
	result := Bundle(model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		Attributes:    []model.AttributeDefinitionV2{{ID: "ability_power"}},
		CoefficientBuckets: []model.CoefficientBucketV2{
			{
				BucketKey:        "bad_attr_stage",
				ResolutionDomain: "attribute",
				StageKey:         "attr_final",
				TargetAttrKey:    "ability_power",
				AggregationMode:  "multiply",
			},
		},
	})
	if !hasProblem(result.Problems, "unsupported coefficient bucket stage key") {
		t.Fatalf("missing stage key problem: %v", result.Problems)
	}
}

func TestBundleRejectsInvalidCoefficientBucketStageForHPChange(t *testing.T) {
	result := Bundle(model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		CoefficientBuckets: []model.CoefficientBucketV2{
			{
				BucketKey:        "bad_hp_stage",
				ResolutionDomain: "hp_change",
				StageKey:         "incoming",
				AggregationMode:  "add",
			},
		},
	})
	if !hasProblem(result.Problems, "unsupported coefficient bucket stage key") {
		t.Fatalf("missing stage key problem: %v", result.Problems)
	}
}

func TestBundleRejectsInvalidCoefficientBucketValueUnit(t *testing.T) {
	result := Bundle(model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		CoefficientBuckets: []model.CoefficientBucketV2{
			{
				BucketKey:        "bad_value_unit",
				ResolutionDomain: "hp_change",
				StageKey:         "hp_change/incoming/pre_mitigation",
				AggregationMode:  "add",
				BucketConfig: model.CoefficientBucketConfigV2{
					ValueUnit: "percent",
				},
			},
		},
	})
	if !hasProblem(result.Problems, "unsupported coefficient bucket value unit") {
		t.Fatalf("missing value unit problem: %v", result.Problems)
	}
}

func TestBundleRejectsSetFinalWithoutFinalValue(t *testing.T) {
	result := Bundle(model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		CoefficientBuckets: []model.CoefficientBucketV2{
			{
				BucketKey:        "set_final_bad",
				ResolutionDomain: "hp_change",
				StageKey:         "hp_change/final/post_mitigation",
				AggregationMode:  "set_final",
			},
			{
				BucketKey:        "set_final_wrong_unit",
				ResolutionDomain: "hp_change",
				StageKey:         "hp_change/final/post_mitigation",
				AggregationMode:  "set_final",
				BucketConfig: model.CoefficientBucketConfigV2{
					ValueUnit: "percent_delta",
				},
			},
		},
	})
	if !hasProblem(result.Problems, "coefficient bucket set_final requires valueUnit final_value") {
		t.Fatalf("missing set_final problem: %v", result.Problems)
	}
	if len(result.Problems) < 2 {
		t.Fatalf("expected at least 2 set_final problems, got %v", result.Problems)
	}
}

func TestBundleAcceptsSetFinalWithFinalValue(t *testing.T) {
	result := Bundle(model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		CoefficientBuckets: []model.CoefficientBucketV2{
			{
				BucketKey:        "set_final_ok",
				ResolutionDomain: "hp_change",
				StageKey:         "hp_change/final/post_mitigation",
				AggregationMode:  "set_final",
				BucketConfig: model.CoefficientBucketConfigV2{
					ValueUnit: "final_value",
				},
			},
		},
	})
	if len(result.Problems) != 0 {
		t.Fatalf("compile problems: %v", result.Problems)
	}
	if len(result.Bundle.CoefficientBuckets) != 1 {
		t.Fatalf("bucket count = %d, want 1", len(result.Bundle.CoefficientBuckets))
	}
	bucket := result.Bundle.CoefficientBuckets[0]
	if bucket.AggregationMode != AggregationModeSetFinal || bucket.Config.ValueUnit != "final_value" {
		t.Fatalf("set_final bucket = %+v", bucket)
	}
}

func TestBundleWithoutCoefficientBucketsStillCompiles(t *testing.T) {
	result := Bundle(model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		Attributes: []model.AttributeDefinitionV2{
			{ID: "attack_damage", DefaultBase: 10},
		},
	})
	if len(result.Problems) != 0 {
		t.Fatalf("compile problems: %v", result.Problems)
	}
	if result.Bundle.CoefficientBuckets != nil {
		t.Fatalf("expected nil coefficient buckets, got %+v", result.Bundle.CoefficientBuckets)
	}
	if result.Bundle.CoefficientBucketIndex != nil {
		t.Fatalf("expected nil coefficient bucket index, got %+v", result.Bundle.CoefficientBucketIndex)
	}
}
