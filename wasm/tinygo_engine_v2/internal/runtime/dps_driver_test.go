package runtime

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/abi"
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

const (
	dpsTestDefaultBasicAttackActionID   = "self::skill_lol_basic_attack_default"
	dpsTestDefaultBasicAttackSkillID    = "skill_lol_basic_attack_default"
	dpsTestSecondaryBasicAttackActionID = "self::skill_lol_basic_attack_secondary"
	dpsTestSecondaryBasicAttackSkillID  = "skill_lol_basic_attack_secondary"
	dpsTestCooldownSkillActionID        = "self::skill_lol_q_test"
	dpsTestCooldownSkillSkillID         = "skill_lol_q_test"
)

func dpsTestEngineBundle() model.EngineBundle {
	return model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		Attributes: []model.AttributeDefinitionV2{
			{ID: "attack_damage"},
			{ID: "attack_speed"},
			{ID: "crit_chance"},
			{ID: "crit_damage", DefaultBase: 1},
			{ID: "hp"},
			{ID: "armor"},
			{ID: "magic_resist"},
			{ID: "armor_pen_percent"},
			{ID: "armor_pen_flat"},
			{ID: "magic_pen_percent"},
			{ID: "magic_pen_flat"},
			{ID: "ap"},
			{ID: "adaptive_force"},
			{ID: "health_regen"},
			{ID: "ms_pct"},
			{ID: "life_steal"},
		},
		Actors: []model.ActorTemplate{
			{
				ID:        "dps_attacker",
				MaxHP:     10000,
				InitialHP: 10000,
				Attributes: map[string]model.AttributeValueV2{
					"attack_damage": {Base: 60},
					"attack_speed":  {Base: 0.658},
					"crit_chance":   {Base: 0},
					"crit_damage":   {Base: 1},
				},
				Actions: []string{dpsTestDefaultBasicAttackActionID, dpsTestSecondaryBasicAttackActionID, dpsTestCooldownSkillActionID},
			},
			{
				ID:        "target_dummy_fighter",
				MaxHP:     10000,
				InitialHP: 10000,
				Attributes: map[string]model.AttributeValueV2{
					"hp":           {Base: 3000},
					"armor":        {Base: 100},
					"magic_resist": {Base: 80},
				},
			},
		},
		Statuses: []model.StatusTemplate{
			{ID: "disarm", Kind: "control", Classifier: model.ClassifierV2{Types: []string{"status/disarm"}}},
		},
		StatusActionControlRules: []model.StatusActionControlRuleV2{
			{
				ID:          "disarm_forbid_basic_attack",
				RuleKind:    "forbid",
				StatusTypes: model.TypeMatcherV2{Any: []string{"status/disarm"}},
				ActionTypes: model.TypeMatcherV2{Any: []string{"action/basic_attack"}},
			},
		},
		Formulas: []model.FormulaDefinition{
			{ID: "one", Op: "const", Value: 1},
			{ID: "as_floor", Op: "const", Value: 0.01},
			{ID: "as_cap", Op: "const", Value: 3.0},
			{ID: "thousand", Op: "const", Value: 1000},
			{ID: "attack_damage", Op: "attr", Attr: "attack_damage"},
			{ID: "ap", Op: "attr", Attr: "ap"},
			{ID: "attack_speed", Op: "attr", Attr: "attack_speed"},
			{ID: "as_capped_low", Op: "max", Left: "attack_speed", Right: "as_floor"},
			{ID: "as_capped", Op: "min", Left: "as_capped_low", Right: "as_cap"},
			{ID: "aa_cooldown_ms", Op: "div", Left: "thousand", Right: "as_capped"},
			{ID: "ad_percent_delta", Op: "div", Left: "attack_damage", Right: "thousand"},
		},
		Actions: []model.ActionTemplate{
			{
				ID:                dpsTestDefaultBasicAttackActionID,
				Label:             "Default Basic Attack",
				Classifier:        model.ClassifierV2{Types: []string{"action/basic_attack"}},
				CooldownFormulaID: "aa_cooldown_ms",
				Effects: []model.EffectDef{
					{
						Type:                 "deal_damage",
						FormulaID:            "attack_damage",
						DamageType:           "physical",
						SourceRole:           "source",
						TargetRole:           "target",
						CritPolicy:           "expected",
						CritChanceSource:     "attacker_crit_chance",
						CritMultiplierSource: "attacker_crit_damage",
					},
				},
			},
			{
				ID:                dpsTestSecondaryBasicAttackActionID,
				Label:             "Secondary Basic Attack",
				Classifier:        model.ClassifierV2{Types: []string{"action/basic_attack"}},
				CooldownFormulaID: "aa_cooldown_ms",
				Effects: []model.EffectDef{
					{
						Type:                 "deal_damage",
						FormulaID:            "attack_damage",
						DamageType:           "physical",
						SourceRole:           "source",
						TargetRole:           "target",
						CritPolicy:           "expected",
						CritChanceSource:     "attacker_crit_chance",
						CritMultiplierSource: "attacker_crit_damage",
					},
				},
			},
			{
				ID:         dpsTestCooldownSkillActionID,
				Label:      "Cooldown Skill",
				Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}, Tags: []string{"skill_tag/spell_damage"}},
				CooldownMs: 500,
				Effects: []model.EffectDef{
					{
						Type:       "deal_damage",
						FormulaID:  "ap",
						DamageType: "magic",
						SourceRole: "source",
						TargetRole: "target",
					},
				},
			},
		},
		Settings: model.BundleSettings{MaxEvents: 10000, MaxCommandsPerEvent: 64},
		CoefficientBuckets: []model.CoefficientBucketV2{
			{
				BucketKey:        "incoming_physical_reduction",
				ResolutionDomain: "hp_change",
				StageKey:         dpsHPChangeStageIncomingPreMitigation,
				AggregationMode:  "add",
				BucketConfig:     model.CoefficientBucketConfigV2{ValueUnit: "percent_delta"},
			},
			{
				BucketKey:        "incoming_magic_reduction",
				ResolutionDomain: "hp_change",
				StageKey:         dpsHPChangeStageIncomingPreMitigation,
				AggregationMode:  "add",
				BucketConfig:     model.CoefficientBucketConfigV2{ValueUnit: "percent_delta"},
			},
			{
				BucketKey:        "final_post_mitigation",
				ResolutionDomain: "hp_change",
				StageKey:         dpsHPChangeStageFinalPostMitigation,
				AggregationMode:  "add",
				BucketConfig:     model.CoefficientBucketConfigV2{ValueUnit: "percent_delta"},
			},
			{
				BucketKey:        "flat_post_percent",
				ResolutionDomain: "hp_change",
				StageKey:         dpsHPChangeStageFlatPostPercent,
				AggregationMode:  "add",
				BucketConfig:     model.CoefficientBucketConfigV2{ValueUnit: "flat_delta"},
			},
			{
				BucketKey:        "outgoing_add_priority_late",
				ResolutionDomain: "hp_change",
				StageKey:         dpsHPChangeStageOutgoingPreMitigation,
				AggregationMode:  "add",
				BucketConfig:     model.CoefficientBucketConfigV2{ValueUnit: "percent_delta", Priority: 20},
			},
			{
				BucketKey:        "outgoing_multiply_priority_early",
				ResolutionDomain: "hp_change",
				StageKey:         dpsHPChangeStageOutgoingPreMitigation,
				AggregationMode:  "multiply",
				BucketConfig:     model.CoefficientBucketConfigV2{ValueUnit: "factor", Priority: 10},
			},
			{
				BucketKey:        "ap_final_multiplier",
				ResolutionDomain: "attribute",
				StageKey:         dpsAttributeStageFinalMultiplier,
				TargetAttrKey:    "ap",
				AggregationMode:  "add",
				BucketConfig:     model.CoefficientBucketConfigV2{ValueUnit: "percent_delta"},
			},
			{
				BucketKey:        "hp_flat_bonus",
				ResolutionDomain: "attribute",
				StageKey:         dpsAttributeStageFlatBonus,
				TargetAttrKey:    "hp",
				AggregationMode:  "add",
				BucketConfig:     model.CoefficientBucketConfigV2{ValueUnit: "flat_delta"},
			},
			{
				BucketKey:        "adaptive_force_flat_bonus",
				ResolutionDomain: "attribute",
				StageKey:         dpsAttributeStageFlatBonus,
				TargetAttrKey:    "adaptive_force",
				AggregationMode:  "add",
				BucketConfig:     model.CoefficientBucketConfigV2{ValueUnit: "flat_delta"},
			},
			{
				BucketKey:        "health_regen_flat_bonus",
				ResolutionDomain: "attribute",
				StageKey:         dpsAttributeStageFlatBonus,
				TargetAttrKey:    "health_regen",
				AggregationMode:  "add",
				BucketConfig:     model.CoefficientBucketConfigV2{ValueUnit: "flat_delta"},
			},
			{
				BucketKey:        "target_armor_flat_bonus",
				ResolutionDomain: "attribute",
				StageKey:         dpsAttributeStageFlatBonus,
				TargetAttrKey:    "armor",
				AggregationMode:  "add",
				BucketConfig:     model.CoefficientBucketConfigV2{ValueUnit: "flat_delta"},
			},
			{
				BucketKey:        "hp_flat_pick_max",
				ResolutionDomain: "attribute",
				StageKey:         dpsAttributeStageFlatBonus,
				TargetAttrKey:    "hp",
				AggregationMode:  "pick_max",
				BucketConfig:     model.CoefficientBucketConfigV2{ValueUnit: "flat_delta"},
			},
			{
				BucketKey:        "incoming_set_final_test",
				ResolutionDomain: "hp_change",
				StageKey:         dpsHPChangeStageIncomingPreMitigation,
				AggregationMode:  "set_final",
				BucketConfig:     model.CoefficientBucketConfigV2{ValueUnit: "final_value"},
			},
		},
	}
}

func compileDPSTestBundle(t *testing.T) compilebundle.CompiledBundle {
	t.Helper()
	result := compilebundle.Bundle(dpsTestEngineBundle())
	if len(result.Problems) > 0 {
		t.Fatalf("compile dps test bundle: %v", result.Problems)
	}
	return result.Bundle
}

func runSingleAttackerDPSForTest(t *testing.T, input model.SingleAttackerDPSInputV2) model.SingleAttackerDPSOutputV2 {
	t.Helper()
	return runSingleAttackerDPS(compileDPSTestBundle(t), input)
}

func defaultDPSBasicAttackActionRef() model.DPSBasicAttackActionRefV2 {
	return model.DPSBasicAttackActionRefV2{
		ActionID:   dpsTestDefaultBasicAttackActionID,
		SkillID:    dpsTestDefaultBasicAttackSkillID,
		Classifier: model.ClassifierV2{Types: []string{"action/basic_attack"}},
	}
}

func secondaryDPSBasicAttackActionRef() model.DPSBasicAttackActionRefV2 {
	return model.DPSBasicAttackActionRefV2{
		ActionID:   dpsTestSecondaryBasicAttackActionID,
		SkillID:    dpsTestSecondaryBasicAttackSkillID,
		Classifier: model.ClassifierV2{Types: []string{"action/basic_attack"}},
	}
}

func TestSingleAttackerDPSBasicAttackTimelineStopsOnTargetDeath(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 10000
	input.Curves[0].ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	input.Curves[0].ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.CurrentHP = 125
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.MaxHP = 125
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 100

	output := runSingleAttackerDPSForTest(t, input)
	if len(output.CurveResults) != 1 {
		t.Fatalf("curveResults length = %d, want 1", len(output.CurveResults))
	}
	result := output.CurveResults[0]
	if result.Status != "ok" || result.StopReason != "target_dead" {
		t.Fatalf("status/stopReason = %s/%s, want ok/target_dead", result.Status, result.StopReason)
	}
	if got := result.AttackTimeline; len(got) != 3 || got[0].TimeMs != 0 || got[1].TimeMs != 1000 || got[2].TimeMs != 2000 {
		t.Fatalf("attack timeline = %+v, want attacks at 0/1000/2000", got)
	}
	if len(result.AttackIntervalTimeline) != 2 {
		t.Fatalf("attack interval count = %d, want 2", len(result.AttackIntervalTimeline))
	}
	firstInterval := result.AttackIntervalTimeline[0]
	if firstInterval.RawAttackSpeed != 1 || firstInterval.EffectiveAttackSpeed != 1 || firstInterval.OverflowAttackSpeed != 0 || firstInterval.AttackIntervalMs != 1000 {
		t.Fatalf("first interval = %+v, want raw/effective=1 overflow=0 interval=1000", firstInterval)
	}
	if len(result.DamageTimeline) != 3 {
		t.Fatalf("damage timeline length = %d, want 3", len(result.DamageTimeline))
	}
	if !almostEqual(result.DamageTimeline[0].FinalDamage, 50) || !almostEqual(result.DamageTimeline[2].FinalDamage, 25) {
		t.Fatalf("damage timeline = %+v, want armor-mitigated and clipped physical damage", result.DamageTimeline)
	}
	if result.KillTimeMs == nil || *result.KillTimeMs != 2000 {
		t.Fatalf("killTimeMs = %v, want 2000", result.KillTimeMs)
	}
	if result.KillDps == nil || !almostEqual(*result.KillDps, 62.5) {
		t.Fatalf("killDps = %v, want 62.5", result.KillDps)
	}
	lastHP := result.TargetHPTimeline[len(result.TargetHPTimeline)-1]
	if lastHP.TimeMs != 10000 || lastHP.CurrentHP != 0 {
		t.Fatalf("final target HP timeline = %+v, want HP held at 0 through duration", lastHP)
	}
	if !almostEqual(result.TimeWindowDps, 12.5) {
		t.Fatalf("timeWindowDps = %.4f, want 12.5", result.TimeWindowDps)
	}
	if len(result.SkillPassiveTriggers) != 0 || len(result.ItemPassiveTriggers) != 0 || len(result.ExternalPassiveTriggers) != 0 {
		t.Fatalf("passive triggers should be empty: skill=%v item=%v external=%v", result.SkillPassiveTriggers, result.ItemPassiveTriggers, result.ExternalPassiveTriggers)
	}
}

func TestSingleAttackerDPSAttackSpeedCapOnlyConstrainsCadence(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1000
	input.SimulationRules.AttackSpeedCap = 3
	input.Curves[0].ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 90
	input.Curves[0].ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 3.5
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if got := result.AttackTimeline; len(got) != 4 || got[0].TimeMs != 0 || got[1].TimeMs != 333 || got[2].TimeMs != 666 || got[3].TimeMs != 999 {
		t.Fatalf("attack timeline = %+v, want cap-derived attacks at 0/333/666/999", got)
	}
	interval := result.AttackIntervalTimeline[0]
	if interval.RawAttackSpeed != 3.5 || interval.EffectiveAttackSpeed != 3 || interval.OverflowAttackSpeed != 0.5 || interval.AttackIntervalMs != 333 {
		t.Fatalf("interval = %+v, want raw=3.5 effective=3 overflow=.5 interval=333", interval)
	}
	if !almostEqual(result.TotalDamage, 360) {
		t.Fatalf("totalDamage = %.4f, want four uncapped damage applications", result.TotalDamage)
	}
}

func TestSingleAttackerDPSExpectedCritDamageForBasicAttacks(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1000
	input.Curves[0].ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	input.Curves[0].ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	input.Curves[0].ResolvedSnapshot.AttackerSnapshot.Attributes["crit_chance"] = 0.25
	input.Curves[0].ResolvedSnapshot.AttackerSnapshot.Attributes["crit_damage"] = 2
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" || result.AttackCount != 1 {
		t.Fatalf("result = %+v, want one ok attack", result)
	}
	if !almostEqual(result.TotalDamage, 125) || !almostEqual(result.DamageTimeline[0].RawDamage, 125) {
		t.Fatalf("damage = %+v total=%.4f, want expected crit raw damage 125", result.DamageTimeline, result.TotalDamage)
	}

	input.Curves[0].ResolvedSnapshot.AttackerSnapshot.Attributes["crit_chance"] = 1
	input.Curves[0].ResolvedSnapshot.AttackerSnapshot.Attributes["crit_damage"] = 2
	result = runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if !almostEqual(result.TotalDamage, 200) || !almostEqual(result.DamageTimeline[0].RawDamage, 200) {
		t.Fatalf("damage = %+v total=%.4f, want guaranteed crit damage 200", result.DamageTimeline, result.TotalDamage)
	}
}

func TestSingleAttackerDPSArmorPenetrationAppliesToPhysicalDamage(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1000
	input.Curves[0].ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	input.Curves[0].ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	input.Curves[0].ResolvedSnapshot.AttackerSnapshot.Attributes["armor_pen_percent"] = 0.3
	input.Curves[0].ResolvedSnapshot.AttackerSnapshot.Attributes["armor_pen_flat"] = 10
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 100

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" || result.AttackCount != 1 {
		t.Fatalf("result = %+v, want one ok attack", result)
	}
	if !almostEqual(result.TotalDamage, 62.5) || !almostEqual(result.DamageTimeline[0].FinalDamage, 62.5) {
		t.Fatalf("damage = %+v total=%.4f, want armor 100 -> 60 after pen, final 62.5", result.DamageTimeline, result.TotalDamage)
	}
}

func TestSingleAttackerDPSEquipmentStatsAreMergedIntoAttackerAttributes(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.Curves[0].Selection.EquipmentSet = []string{"3031", "3046"}
	input.Curves[0].ResolvedSnapshot.EquipmentSet = []string{"3031", "3046"}
	input.Curves[0].ResolvedSnapshot.EquipmentStats = map[string]float64{
		"ad":           75,
		"attack_speed": 0.65,
		"crit_chance":  0.25,
	}
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.CurrentHP = 3000
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.MaxHP = 3000
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 100

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if got := result.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"]; !almostEqual(got, 135) {
		t.Fatalf("merged ad = %.4f, want 135", got)
	}
	if got := result.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"]; !almostEqual(got, 1.308) {
		t.Fatalf("merged attack_speed = %.4f, want 1.308", got)
	}
	if got := result.ResolvedSnapshot.EquipmentStats["crit_chance"]; !almostEqual(got, 0.25) {
		t.Fatalf("equipmentStats crit_chance = %.4f, want preserved evidence 0.25", got)
	}
	if result.AttackCount != 14 {
		t.Fatalf("attackCount = %d, want 14 attacks with merged attack speed", result.AttackCount)
	}
	if !almostEqual(result.TotalDamage, 945) {
		t.Fatalf("totalDamage = %.4f, want 14 armor-mitigated attacks for 945", result.TotalDamage)
	}
	firstDamage := result.DamageTimeline[0]
	if !almostEqual(firstDamage.RawDamage, 135) || !almostEqual(firstDamage.FinalDamage, 67.5) {
		t.Fatalf("firstDamage = %+v, want merged AD then armor mitigation", firstDamage)
	}
}

func TestSingleAttackerDPSAttackerAttrReadDefaultsToResolved(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 500
	passive := attackerAttrRatioOnHitPassive("item_attr_ratio_default", "ad", 1, "")
	curve := &input.Curves[0]
	curve.CurveID = "attacker-attr-read-default-resolved"
	enableDPSPassivesForTest(curve, passive)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 60
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.EquipmentSet = []string{"3078"}
	curve.ResolvedSnapshot.EquipmentStats = map[string]float64{"ad": 36}
	curve.Selection.EquipmentSet = []string{"3078"}
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if got := rawDamagesBySource(result, "item_attr_ratio_default"); len(got) != 1 || !almostEqual(got[0], 96) {
		t.Fatalf("passive raw damages = %v, want resolved ad 96 on first hit", got)
	}
	if !effectBreakdownMessageContains(result, dpsOpDamage, "attackerAttr=ad attackerAttrRead=resolved attrValue=96 attackerAttrRatio=1 contribution=96") {
		t.Fatalf("effectBreakdown = %+v, want resolved attr read evidence", result.EffectBreakdown)
	}
}

func TestSingleAttackerDPSAttackerAttrReadBaseIgnoresEquipmentStats(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 500
	passive := attackerAttrRatioOnHitPassive("trinity_force_spellblade", "ad", 2, model.AttrReadBase)
	curve := &input.Curves[0]
	curve.CurveID = "attacker-attr-read-base-ignores-equipment"
	enableDPSPassivesForTest(curve, passive)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 60
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.AttackerSnapshot.AttributeViews = map[string]model.AttributeSnapshotV2{
		"ad": {Base: 60, Current: 60, Max: 60, Resolved: 60},
	}
	curve.ResolvedSnapshot.EquipmentSet = []string{"3078"}
	curve.ResolvedSnapshot.EquipmentStats = map[string]float64{"ad": 36}
	curve.Selection.EquipmentSet = []string{"3078"}
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if got := result.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"]; !almostEqual(got, 96) {
		t.Fatalf("merged resolved ad = %.4f, want 96", got)
	}
	if got := result.ResolvedSnapshot.AttackerSnapshot.AttributeViews["ad"].Base; !almostEqual(got, 60) {
		t.Fatalf("attributeViews.ad.base = %.4f, want equipment not to pollute base", got)
	}
	if got := rawDamagesBySource(result, "trinity_force_spellblade"); len(got) != 1 || !almostEqual(got[0], 120) {
		t.Fatalf("spellblade raw damages = %v, want 2 * base ad 120", got)
	}
	if !effectBreakdownMessageContains(result, dpsOpDamage, "attackerAttr=ad attackerAttrRead=base attrValue=60 attackerAttrRatio=2 contribution=120") {
		t.Fatalf("effectBreakdown = %+v, want base attr read evidence", result.EffectBreakdown)
	}
}

func TestSingleAttackerDPSAttackerAttrReadBaseIgnoresRuntimeStatModifiers(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1200
	passive := attackerAttrRatioOnHitPassive("base_ad_passive", "ad", 1, model.AttrReadBase)
	stacking := canonicalStackingStatModifierPassive("stacking_ad", "stack_ad", 6000, 3, 0, 10)
	curve := &input.Curves[0]
	curve.CurveID = "attacker-attr-read-base-ignores-runtime-modifiers"
	enableDPSPassivesForTest(curve, passive, stacking)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 60
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.AttackerSnapshot.AttributeViews = map[string]model.AttributeSnapshotV2{
		"ad": {Base: 60, Current: 60, Max: 60, Resolved: 60},
	}
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	got := rawDamagesBySource(result, "base_ad_passive")
	if len(got) < 2 || !almostEqual(got[0], 60) || !almostEqual(got[1], 60) {
		t.Fatalf("base ad passive raw damages = %v, want 60 even after stack modifiers", got)
	}
}

func TestSingleAttackerDPSAttackerAttrReadBaseBlocksWhenMissingView(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 500
	passive := attackerAttrRatioOnHitPassive("missing_base_view", "ad", 2, model.AttrReadBase)
	curve := &input.Curves[0]
	curve.CurveID = "attacker-attr-read-base-blocks-missing-view"
	enableDPSPassivesForTest(curve, passive)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 96
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "blocked" {
		t.Fatalf("status = %s, want blocked when base view is missing", result.Status)
	}
	if !blockedReasonContains(result, "requires attacker attr view ad for read base") {
		t.Fatalf("blockedReasons = %v, want missing base view block", result.BlockedReasons)
	}
}

func TestSingleAttackerDPSAttackerAttrReadResolvedKeepsStackModifiers(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1200
	passive := attackerAttrRatioOnHitPassive("resolved_ad_passive", "ad", 1, model.AttrReadResolved)
	stacking := canonicalStackingStatModifierPassive("stacking_ad_resolved", "stack_ad", 6000, 3, 0, 10)
	curve := &input.Curves[0]
	curve.CurveID = "attacker-attr-read-resolved-keeps-stack-modifiers"
	enableDPSPassivesForTest(curve, passive, stacking)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 60
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	got := rawDamagesBySource(result, "resolved_ad_passive")
	if len(got) < 2 || !almostEqual(got[0], 60) || !almostEqual(got[1], 70) {
		t.Fatalf("resolved ad passive raw damages = %v, want 60 then 70 with one stack", got)
	}
	if !effectBreakdownMessageContains(result, dpsOpDamage, "attackerAttrRead=resolved attrValue=70") {
		t.Fatalf("effectBreakdown = %+v, want resolved stack-modified attr evidence on second hit", result.EffectBreakdown)
	}
}

func TestSingleAttackerDPSEquipmentCritStatsAffectBasicAttackDamage(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.Curves[0].Selection.EquipmentSet = []string{"3031", "3046"}
	input.Curves[0].ResolvedSnapshot.EquipmentSet = []string{"3031", "3046"}
	input.Curves[0].ResolvedSnapshot.EquipmentStats = map[string]float64{
		"ad":           75,
		"attack_speed": 0.65,
		"crit_chance":  0.50,
		"crit_damage":  0.30,
	}
	input.Curves[0].ResolvedSnapshot.AttackerSnapshot.Attributes["crit_damage"] = 2
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.CurrentHP = 3000
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.MaxHP = 3000
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 100

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if result.AttackCount != 14 {
		t.Fatalf("attackCount = %d, want 14 attacks with merged attack speed", result.AttackCount)
	}
	firstDamage := result.DamageTimeline[0]
	if !almostEqual(firstDamage.RawDamage, 222.75) || !almostEqual(firstDamage.FinalDamage, 111.375) {
		t.Fatalf("firstDamage = %+v, want AD 135 with expected crit then armor mitigation", firstDamage)
	}
	if !almostEqual(result.TotalDamage, 1559.25) {
		t.Fatalf("totalDamage = %.4f, want 14 expected-crit armor-mitigated attacks", result.TotalDamage)
	}
}

func TestSingleAttackerDPSItemOnHitPassiveRoutesToItemTriggers(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	curve.Selection.EquipmentSet = []string{"3124"}
	curve.Selection.EnabledPassiveEffects = []string{"item_3124_guinsoos_rageblade_wrath_dps_v2"}
	curve.ResolvedSnapshot.EquipmentSet = []string{"3124"}
	curve.ResolvedSnapshot.EquipmentStats = map[string]float64{"ad": 30, "ap": 30, "attack_speed": 0.25}
	curve.ResolvedSnapshot.EnabledPassiveEffects = []string{"item_3124_guinsoos_rageblade_wrath_dps_v2"}
	curve.ResolvedSnapshot.PassiveEffects = []model.DPSPassiveEffectV2{guinsoosWrathPassive()}
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.SkillPassiveTriggers) != 0 || len(result.ItemPassiveTriggers) != 1 {
		t.Fatalf("passive triggers skill=%v item=%v, want one item trigger", result.SkillPassiveTriggers, result.ItemPassiveTriggers)
	}
	if !almostEqual(result.DamageBySource["guinsoos_wrath_on_hit"], 30) || !almostEqual(result.DamageByType["magic"], 30) {
		t.Fatalf("damageBySource=%v damageByType=%v, want 30 magic item on-hit", result.DamageBySource, result.DamageByType)
	}
	encoded := string(mustJSONForDPSTest(t, result))
	if !strings.Contains(encoded, `"itemPassiveTriggers":[{"timeMs":0`) {
		t.Fatalf("encoded itemPassiveTriggers should retain timeMs=0: %s", encoded)
	}
	if !strings.Contains(encoded, `"effectBreakdown":[{"timeMs":0`) {
		t.Fatalf("encoded effectBreakdown should retain timeMs=0: %s", encoded)
	}
}

func TestSingleAttackerDPSItemCurrentHPOnHitUsesAttackStartBasis(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	curve.Selection.EquipmentSet = []string{"3153"}
	curve.Selection.EnabledPassiveEffects = []string{"item_3153_blade_of_the_ruined_king_mists_edge_dps_v2"}
	curve.ResolvedSnapshot.EquipmentSet = []string{"3153"}
	curve.ResolvedSnapshot.EquipmentStats = map[string]float64{"ad": 40, "attack_speed": 0.25, "life_steal": 0.1}
	curve.ResolvedSnapshot.EnabledPassiveEffects = []string{"item_3153_blade_of_the_ruined_king_mists_edge_dps_v2"}
	curve.ResolvedSnapshot.PassiveEffects = []model.DPSPassiveEffectV2{bladeOfTheRuinedKingPassive()}
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if !almostEqual(result.DamageBySource["blade_of_the_ruined_king_current_hp_on_hit"], 60) {
		t.Fatalf("damageBySource=%v, want 6%% of 1000 attack-start HP for ranged holder", result.DamageBySource)
	}
	if !almostEqual(result.TotalDamage, 160) {
		t.Fatalf("totalDamage = %.4f, want 100 basic physical + 60 item physical", result.TotalDamage)
	}
}

func TestSingleAttackerDPSItemCurrentHPOnHitUsesCurrentBasis(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	curve.Selection.EquipmentSet = []string{"3153"}
	curve.Selection.EnabledPassiveEffects = []string{"item_3153_blade_of_the_ruined_king_mists_edge_dps_v2"}
	curve.ResolvedSnapshot.EquipmentSet = []string{"3153"}
	curve.ResolvedSnapshot.EquipmentStats = map[string]float64{"ad": 40, "attack_speed": 0.25, "life_steal": 0.1}
	curve.ResolvedSnapshot.EnabledPassiveEffects = []string{"item_3153_blade_of_the_ruined_king_mists_edge_dps_v2"}
	passive := bladeOfTheRuinedKingPassive()
	passive.Operations[0].TargetCurrentHPBasis = "current"
	curve.ResolvedSnapshot.PassiveEffects = []model.DPSPassiveEffectV2{passive}
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if !almostEqual(result.DamageBySource["blade_of_the_ruined_king_current_hp_on_hit"], 54) {
		t.Fatalf("damageBySource=%v, want 6%% of post-basic current HP 900", result.DamageBySource)
	}
	if !almostEqual(result.TotalDamage, 154) {
		t.Fatalf("totalDamage = %.4f, want 100 basic physical + 54 current-HP item physical", result.TotalDamage)
	}
}

func TestSingleAttackerDPSItemEveryThirdHitSupportsMissingHPScaling(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 700
	curve := &input.Curves[0]
	curve.Selection.EquipmentSet = []string{"6672"}
	curve.Selection.EnabledPassiveEffects = []string{"item_6672_kraken_slayer_bring_it_down_dps_v2"}
	curve.ResolvedSnapshot.EquipmentSet = []string{"6672"}
	curve.ResolvedSnapshot.EquipmentStats = map[string]float64{"ad": 45, "attack_speed": 0.4, "ms_pct": 0.04}
	curve.ResolvedSnapshot.EnabledPassiveEffects = []string{"item_6672_kraken_slayer_bring_it_down_dps_v2"}
	curve.ResolvedSnapshot.PassiveEffects = []model.DPSPassiveEffectV2{krakenSlayerPassive()}
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 3
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if result.AttackCount != 3 || len(result.ItemPassiveTriggers) != 1 {
		t.Fatalf("attackCount=%d itemTriggers=%v, want three attacks and one Kraken trigger", result.AttackCount, result.ItemPassiveTriggers)
	}
	if !almostEqual(result.DamageBySource["kraken_slayer_bring_it_down"], 138.9) {
		t.Fatalf("damageBySource=%v, want base 120 amplified by 21%% missing HP * 75%% at attack start", result.DamageBySource)
	}
}

func TestSingleAttackerDPSBlocksEquipmentSetWithoutResolvedStats(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.Curves[0].Selection.EquipmentSet = []string{"3031"}
	input.Curves[0].ResolvedSnapshot.EquipmentSet = []string{"3031"}

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "blocked" {
		t.Fatalf("status = %s, want blocked", result.Status)
	}
	if !blockedReasonContains(result, "resolvedSnapshot.equipmentStats is required") {
		t.Fatalf("blockedReasons=%v, want missing equipmentStats reason", result.BlockedReasons)
	}
}

func TestSingleAttackerDPSBlocksMismatchedEquipmentSet(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.Curves[0].Selection.EquipmentSet = []string{"3031"}
	input.Curves[0].ResolvedSnapshot.EquipmentSet = []string{"3046"}
	input.Curves[0].ResolvedSnapshot.EquipmentStats = map[string]float64{"attack_speed": 0.65}

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "blocked" {
		t.Fatalf("status = %s, want blocked", result.Status)
	}
	if !blockedReasonContains(result, "selection.equipmentSet must match resolvedSnapshot.equipmentSet") {
		t.Fatalf("blockedReasons=%v, want mismatched equipmentSet reason", result.BlockedReasons)
	}
}

func TestSingleAttackerDPSTargetEquipmentBackwardCompatibleAttackerOnly(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1000
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, canonicalHeroOnHitPassive())
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok without target equipment fields", result.Status, result.BlockedReasons)
	}
	if len(result.SkillPassiveTriggers)+len(result.ItemPassiveTriggers) == 0 {
		t.Fatalf("passive triggers = skill:%v item:%v, want attacker-only passives to still execute", result.SkillPassiveTriggers, result.ItemPassiveTriggers)
	}
}

func TestSingleAttackerDPSBlocksMismatchedTargetEquipmentSet(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.Curves[0].Selection.TargetEquipmentSet = []string{"3075"}
	input.Curves[0].ResolvedSnapshot.TargetEquipmentSet = []string{"3143"}
	input.Curves[0].ResolvedSnapshot.TargetEquipmentStats = map[string]float64{}

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "blocked" {
		t.Fatalf("status = %s, want blocked", result.Status)
	}
	if !blockedReasonContains(result, "selection.targetEquipmentSet must match resolvedSnapshot.targetEquipmentSet") {
		t.Fatalf("blockedReasons=%v, want mismatched targetEquipmentSet reason", result.BlockedReasons)
	}
}

func TestSingleAttackerDPSBlocksTargetEquipmentSetWithoutResolvedStats(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.Curves[0].Selection.TargetEquipmentSet = []string{"3075"}
	input.Curves[0].ResolvedSnapshot.TargetEquipmentSet = []string{"3075"}

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "blocked" {
		t.Fatalf("status = %s, want blocked", result.Status)
	}
	if !blockedReasonContains(result, "resolvedSnapshot.targetEquipmentStats is required when targetEquipmentSet is present") {
		t.Fatalf("blockedReasons=%v, want missing targetEquipmentStats reason", result.BlockedReasons)
	}
}

func TestSingleAttackerDPSAllowsEmptyTargetEquipmentStatsObject(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1000
	curve := &input.Curves[0]
	enableTargetDPSPassivesForTest(curve, "3075", syntheticThornmailRetaliationPassive())
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok with empty targetEquipmentStats object", result.Status, result.BlockedReasons)
	}
}

func TestSingleAttackerDPSBlocksMissingTargetEnabledPassive(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	curve := &input.Curves[0]
	curve.Selection.TargetEquipmentSet = []string{"3075"}
	curve.ResolvedSnapshot.TargetEquipmentSet = []string{"3075"}
	curve.ResolvedSnapshot.TargetEquipmentStats = map[string]float64{}
	curve.Selection.TargetEnabledPassiveEffects = []string{"item_thornmail_retaliation_test"}
	curve.ResolvedSnapshot.TargetEnabledPassiveEffects = []string{"item_thornmail_retaliation_test"}

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "blocked" {
		t.Fatalf("status = %s, want blocked", result.Status)
	}
	if !blockedReasonContains(result, "target enabled passive effect item_thornmail_retaliation_test is missing from resolvedSnapshot.passiveEffects") {
		t.Fatalf("blockedReasons=%v, want missing target enabled passive reason", result.BlockedReasons)
	}
}

func TestSingleAttackerDPSBlocksTargetEnabledPassiveWithAttackerOwnerRole(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	curve := &input.Curves[0]
	passive := syntheticBlackCleaverArmorShredPassive()
	enableTargetDPSPassivesForTest(curve, "3071", passive)

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "blocked" {
		t.Fatalf("status = %s, want blocked", result.Status)
	}
	if !blockedReasonContains(result, "target enabled passive effect item_black_cleaver_armor_shred_test requires ownerRole target") {
		t.Fatalf("blockedReasons=%v, want attacker ownerRole blocked in targetEnabledPassiveEffects", result.BlockedReasons)
	}
}

func TestSingleAttackerDPSBlockedWhenPublishedSnapshotDataIsMissing(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	delete(input.Curves[0].ResolvedSnapshot.TargetSnapshot.Attributes, "armor")

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "blocked" || result.StopReason != "blocked" {
		t.Fatalf("status/stopReason = %s/%s, want blocked/blocked", result.Status, result.StopReason)
	}
	if len(result.BlockedReasons) == 0 {
		t.Fatal("blockedReasons should explain missing published snapshot data")
	}
	if len(result.DamageTimeline) != 0 || result.TotalDamage != 0 {
		t.Fatalf("blocked curve should not synthesize damage: timeline=%v total=%.2f", result.DamageTimeline, result.TotalDamage)
	}
}

func TestSingleAttackerDPSBlockedWhenTargetIsNotTargetDummy(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.Curves[0].Selection.TargetType = "target_dummy"
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.Types = []string{"champion"}

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "blocked" || result.StopReason != "blocked" {
		t.Fatalf("status/stopReason = %s/%s, want blocked/blocked", result.Status, result.StopReason)
	}
	if len(result.BlockedReasons) == 0 {
		t.Fatal("blockedReasons should explain the target type constraint")
	}
}

func TestSingleAttackerDPSBlockedWhenSelectionTargetDoesNotMatchResolvedTarget(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.Curves[0].Selection.TargetID = "target_dummy_tank"

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "blocked" || result.StopReason != "blocked" {
		t.Fatalf("status/stopReason = %s/%s, want blocked/blocked", result.Status, result.StopReason)
	}
	if len(result.BlockedReasons) == 0 {
		t.Fatal("blockedReasons should explain the target identity constraint")
	}
}

func TestSingleAttackerDPSBlockedWhenSelectionTargetIsMissing(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.Curves[0].Selection.TargetID = ""

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "blocked" || result.StopReason != "blocked" {
		t.Fatalf("status/stopReason = %s/%s, want blocked/blocked", result.Status, result.StopReason)
	}
	if len(result.BlockedReasons) == 0 {
		t.Fatal("blockedReasons should explain the required target identity")
	}
}

func TestSingleAttackerDPSBlockedWhenResolvedTargetIsMissing(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.Curves[0].ResolvedSnapshot.TargetSnapshot = model.DPSActorSnapshotV2{}

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "blocked" || result.StopReason != "blocked" {
		t.Fatalf("status/stopReason = %s/%s, want blocked/blocked", result.Status, result.StopReason)
	}
	if len(result.BlockedReasons) == 0 {
		t.Fatal("blockedReasons should explain the required resolved target snapshot")
	}
}

func TestSingleAttackerDPSBlockedWhenBatchARulesAreUnsupported(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*model.SingleAttackerDPSInputV2)
	}{
		{
			name: "warmup",
			mutate: func(input *model.SingleAttackerDPSInputV2) {
				input.SimulationRules.WarmupMs = 1000
			},
		},
		{
			name: "sampleBy",
			mutate: func(input *model.SingleAttackerDPSInputV2) {
				input.SimulationRules.SampleBy = "interval"
			},
		},
		{
			name: "eventWindowPolicy",
			mutate: func(input *model.SingleAttackerDPSInputV2) {
				input.SimulationRules.EventWindowPolicy = "timeMs <= durationMs"
			},
		},
		{
			name: "dotTickInterval",
			mutate: func(input *model.SingleAttackerDPSInputV2) {
				input.SimulationRules.DotTickIntervalMs = 250
			},
		},
		{
			name: "critPolicy",
			mutate: func(input *model.SingleAttackerDPSInputV2) {
				input.SimulationRules.CritPolicy = "seeded_random"
			},
		},
		{
			name: "attackSpeedCap",
			mutate: func(input *model.SingleAttackerDPSInputV2) {
				input.SimulationRules.AttackSpeedCap = 4.0
			},
		},
		{
			name: "firstAttack",
			mutate: func(input *model.SingleAttackerDPSInputV2) {
				input.SimulationRules.FirstAttackAtMs = 100
			},
		},
		{
			name: "autoAttackStart",
			mutate: func(input *model.SingleAttackerDPSInputV2) {
				input.SimulationRules.AutoAttackPlan.StartAtMs = 100
			},
		},
		{
			name: "autoAttackDisabled",
			mutate: func(input *model.SingleAttackerDPSInputV2) {
				input.SimulationRules.AutoAttackPlan.Enabled = false
			},
		},
		{
			name: "missingBasicAttackAction",
			mutate: func(input *model.SingleAttackerDPSInputV2) {
				input.Curves[0].ResolvedSnapshot.BasicAttackActions[0].ActionID = "missing_action"
			},
		},
		{
			name: "autoAttackTargetRole",
			mutate: func(input *model.SingleAttackerDPSInputV2) {
				input.SimulationRules.AutoAttackPlan.TargetRole = "other"
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := baseSingleAttackerDPSInput()
			tt.mutate(&input)

			result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
			if result.Status != "blocked" || result.StopReason != "blocked" {
				t.Fatalf("status/stopReason = %s/%s, want blocked/blocked", result.Status, result.StopReason)
			}
			if len(result.BlockedReasons) == 0 {
				t.Fatal("blockedReasons should explain unsupported Batch A rules")
			}
			if tt.name == "missingBasicAttackAction" && !blockedReasonContains(result, "action_not_found:") {
				t.Fatalf("blockedReasons = %v, want action_not_found", result.BlockedReasons)
			}
		})
	}
}

func TestSingleAttackerDPSBlocksMissingBasicAttackSkill(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.Curves[0].ResolvedSnapshot.BasicAttackActions = nil

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "blocked" || result.StopReason != "blocked" {
		t.Fatalf("status/stopReason = %s/%s, want blocked/blocked", result.Status, result.StopReason)
	}
	if !blockedReasonContains(result, "missing_basic_attack_action") {
		t.Fatalf("blockedReasons = %v, want missing_basic_attack_action", result.BlockedReasons)
	}
}

func TestSingleAttackerDPSRunsMountedBasicAttackAction(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1000
	input.Curves[0].ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	input.Curves[0].ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" || result.AttackCount != 1 {
		t.Fatalf("result = %+v, want one mounted basic attack", result)
	}
	if got := result.AttackTimeline[0].ActionID; got != dpsTestDefaultBasicAttackActionID {
		t.Fatalf("attack actionId = %q, want %q", got, dpsTestDefaultBasicAttackActionID)
	}
	if !almostEqual(result.DamageBySource[dpsTestDefaultBasicAttackSkillID], 100) {
		t.Fatalf("damageBySource = %v, want %q physical basic attack damage", result.DamageBySource, dpsTestDefaultBasicAttackSkillID)
	}
}

func TestSingleAttackerDPSRunsActiveSkillOnCooldownWithoutAttackCount(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1100
	curve := &input.Curves[0]
	curve.ResolvedSnapshot.BasicAttackActions = nil
	curve.ResolvedSnapshot.ActiveActions = []model.DPSActiveActionRefV2{{
		ActionID:   dpsTestCooldownSkillActionID,
		SkillID:    dpsTestCooldownSkillSkillID,
		Kind:       dpsActiveActionKindSkill,
		Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}, Tags: []string{"skill_tag/spell_damage"}},
	}}
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ap"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("result = %+v, want ok", result)
	}
	if result.AttackCount != 0 {
		t.Fatalf("attackCount = %d, want 0 for skill-only activeActions", result.AttackCount)
	}
	if len(result.AttackTimeline) != 0 || len(result.AttackIntervalTimeline) != 0 {
		t.Fatalf("attack timelines = %+v / %+v, want empty for skill actions", result.AttackTimeline, result.AttackIntervalTimeline)
	}
	if got := damageCountBySourceAt(result, dpsTestCooldownSkillSkillID, 0); got != 1 {
		t.Fatalf("damage at 0ms = %d, want 1", got)
	}
	if got := damageCountBySourceAt(result, dpsTestCooldownSkillSkillID, 500); got != 1 {
		t.Fatalf("damage at 500ms = %d, want 1", got)
	}
	if got := damageCountBySourceAt(result, dpsTestCooldownSkillSkillID, 1000); got != 1 {
		t.Fatalf("damage at 1000ms = %d, want 1", got)
	}
	if got := damageCountBySourceAt(result, dpsTestCooldownSkillSkillID, 1100); got != 0 {
		t.Fatalf("damage at 1100ms = %d, want 0 (next cast at 1500ms)", got)
	}
	if !almostEqual(result.DamageBySource[dpsTestCooldownSkillSkillID], 300) {
		t.Fatalf("damageBySource = %v, want 300 from three 100-damage skill casts", result.DamageBySource)
	}
}

func TestSingleAttackerDPSActiveSkillTriggersSpellHitPassive(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	curve.ResolvedSnapshot.BasicAttackActions = nil
	curve.ResolvedSnapshot.ActiveActions = []model.DPSActiveActionRefV2{{
		ActionID:   dpsTestCooldownSkillActionID,
		SkillID:    dpsTestCooldownSkillSkillID,
		Kind:       dpsActiveActionKindSkill,
		Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}, Tags: []string{"skill_tag/spell_damage"}},
	}}
	enableDPSPassivesForTest(curve, syntheticLudenSpellHitPassive())
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ap"] = 100
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("result = %+v, want ok", result)
	}
	if result.AttackCount != 0 {
		t.Fatalf("attackCount = %d, want 0 for skill-only activeActions", result.AttackCount)
	}
	if len(result.ItemPassiveTriggers) != 1 {
		t.Fatalf("itemPassiveTriggers = %+v, want one spell-hit trigger", result.ItemPassiveTriggers)
	}
	if result.ItemPassiveTriggers[0].TriggerID != "luden_spell_hit" {
		t.Fatalf("itemPassiveTriggers = %+v, want luden_spell_hit trigger", result.ItemPassiveTriggers)
	}
	if !almostEqual(result.DamageBySource["luden_spell_hit_proc"], 40) {
		t.Fatalf("damageBySource = %v, want luden spell-hit proc damage", result.DamageBySource)
	}
	if !almostEqual(result.DamageBySource[dpsTestCooldownSkillSkillID], 100) {
		t.Fatalf("damageBySource = %v, want active skill plus spell-hit proc damage", result.DamageBySource)
	}
}

func TestSingleAttackerDPSActiveSkillDoesNotTriggerBasicOnHitPassive(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	curve.ResolvedSnapshot.BasicAttackActions = nil
	curve.ResolvedSnapshot.ActiveActions = []model.DPSActiveActionRefV2{{
		ActionID:   dpsTestCooldownSkillActionID,
		SkillID:    dpsTestCooldownSkillSkillID,
		Kind:       dpsActiveActionKindSkill,
		Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}, Tags: []string{"skill_tag/spell_damage"}},
	}}
	passive := canonicalHeroOnHitPassive()
	enableDPSPassivesForTest(curve, passive)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ap"] = 100
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("result = %+v, want ok", result)
	}
	if result.AttackCount != 0 {
		t.Fatalf("attackCount = %d, want 0 for skill-only activeActions", result.AttackCount)
	}
	if got := result.DamageBySource["canonical_hero_on_hit"]; got != 0 {
		t.Fatalf("canonical on-hit damage = %.4f, want 0 for skill action", got)
	}
	if len(result.SkillPassiveTriggers) != 0 {
		t.Fatalf("skillPassiveTriggers = %+v, want no basic on-hit trigger from skill action", result.SkillPassiveTriggers)
	}
	if !almostEqual(result.DamageBySource[dpsTestCooldownSkillSkillID], 100) {
		t.Fatalf("damageBySource = %v, want only active skill damage", result.DamageBySource)
	}
}

func TestSingleAttackerDPSActiveSkillDoesNotTriggerRealBasicAttackOnlySpellHitPassive(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	curve.ResolvedSnapshot.BasicAttackActions = nil
	curve.ResolvedSnapshot.ActiveActions = []model.DPSActiveActionRefV2{{
		ActionID:   dpsTestCooldownSkillActionID,
		SkillID:    dpsTestCooldownSkillSkillID,
		Kind:       dpsActiveActionKindSkill,
		Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}, Tags: []string{"skill_tag/spell_damage"}},
	}}
	passive := syntheticLudenSpellHitPassive()
	passive.Trigger.Matcher.ProcScopes = []string{dpsProcScopeRealBasicAttackOnly}
	enableDPSPassivesForTest(curve, passive)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ap"] = 100
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("result = %+v, want ok", result)
	}
	if len(result.ItemPassiveTriggers) != 0 {
		t.Fatalf("itemPassiveTriggers = %+v, want no proc from real_basic_attack_only spell-hit passive", result.ItemPassiveTriggers)
	}
	if got := result.DamageBySource["luden_spell_hit_proc"]; got != 0 {
		t.Fatalf("luden proc damage = %.4f, want 0 for active skill with real_basic_attack_only procScope", got)
	}
	if !almostEqual(result.DamageBySource[dpsTestCooldownSkillSkillID], 100) {
		t.Fatalf("damageBySource = %v, want only active skill damage", result.DamageBySource)
	}
}

func TestSingleAttackerDPSSameTimeActiveActionsStopAtEventLimit(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	input.SimulationRules.MaxEvents = 1
	curve := &input.Curves[0]
	curve.ResolvedSnapshot.BasicAttackActions = nil
	curve.ResolvedSnapshot.ActiveActions = []model.DPSActiveActionRefV2{
		{
			ActionID:   dpsTestDefaultBasicAttackActionID,
			SkillID:    dpsTestDefaultBasicAttackSkillID,
			Kind:       dpsActiveActionKindBasicAttack,
			StartAtMs:  0,
			Classifier: model.ClassifierV2{Types: []string{"action/basic_attack"}},
		},
		{
			ActionID:   dpsTestSecondaryBasicAttackActionID,
			SkillID:    dpsTestSecondaryBasicAttackSkillID,
			Kind:       dpsActiveActionKindBasicAttack,
			StartAtMs:  0,
			Classifier: model.ClassifierV2{Types: []string{"action/basic_attack"}},
		},
	}
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 50
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("result = %+v, want ok", result)
	}
	if result.StopReason != "event_limit" {
		t.Fatalf("stopReason = %q, want event_limit", result.StopReason)
	}
	if result.AttackCount != 1 {
		t.Fatalf("attackCount = %d, want only one same-time action before event_limit", result.AttackCount)
	}
	if result.ProcessedEvents != 1 {
		t.Fatalf("processedEvents = %d, want 1", result.ProcessedEvents)
	}
	defaultDamage := result.DamageBySource[dpsTestDefaultBasicAttackSkillID]
	secondaryDamage := result.DamageBySource[dpsTestSecondaryBasicAttackSkillID]
	if (defaultDamage == 0 && secondaryDamage == 0) || (defaultDamage > 0 && secondaryDamage > 0) {
		t.Fatalf("damageBySource = %v, want exactly one of the two same-time basic attacks to fire", result.DamageBySource)
	}
}

func TestSingleAttackerDPSRunsMultipleMountedBasicAttackActions(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	input.Curves[0].ResolvedSnapshot.BasicAttackActions = []model.DPSBasicAttackActionRefV2{
		defaultDPSBasicAttackActionRef(),
		secondaryDPSBasicAttackActionRef(),
	}
	input.Curves[0].ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 50
	input.Curves[0].ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("result = %+v, want ok", result)
	}
	if result.AttackCount != 2 {
		t.Fatalf("attackCount = %d, want both mounted basic attacks at t=0", result.AttackCount)
	}
	if !almostEqual(result.DamageBySource[dpsTestDefaultBasicAttackSkillID], 50) ||
		!almostEqual(result.DamageBySource[dpsTestSecondaryBasicAttackSkillID], 50) {
		t.Fatalf("damageBySource = %v, want 50 from each mounted basic attack", result.DamageBySource)
	}
}

func TestSingleAttackerDPSBasicAttackCooldownUsesAttackSpeedFormula(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 2000
	input.Curves[0].ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 1
	input.Curves[0].ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 2
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" || len(result.AttackIntervalTimeline) < 2 {
		t.Fatalf("result = %+v, want ok with interval evidence", result)
	}
	if got := result.AttackIntervalTimeline[0]; got.AttackIntervalMs != 500 || got.Source != "aa_cooldown_ms" {
		t.Fatalf("first interval = %+v, want 500ms from aa_cooldown_ms", got)
	}
	if got := attackTimes(result); !sameInt64s(got, []int64{0, 500, 1000, 1500}) {
		t.Fatalf("attack times = %v, want cooldown formula cadence at 2.0 AS", got)
	}
}

func TestSingleAttackerDPSBasicAttackHitTriggersPassivesAfterActionDamage(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	passive := canonicalHeroOnHitPassive()
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, passive)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("result = %+v, want ok", result)
	}
	if len(result.SkillPassiveTriggers) != 1 {
		t.Fatalf("skillPassiveTriggers = %v, want on-hit passive after basic attack damage", result.SkillPassiveTriggers)
	}
	if !almostEqual(result.DamageBySource[dpsTestDefaultBasicAttackSkillID], 100) ||
		!almostEqual(result.DamageBySource["canonical_hero_on_hit"], 10) {
		t.Fatalf("damageBySource = %v, want basic attack then on-hit passive", result.DamageBySource)
	}
}

func TestSingleAttackerDPSDisarmBlocksClassifiedBasicAttack(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1000
	input.Curves[0].ResolvedSnapshot.AttackerSnapshot.StatusIDs = []string{"disarm"}
	input.Curves[0].ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	input.Curves[0].ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "blocked" || result.StopReason != "blocked" {
		t.Fatalf("status/stopReason = %s/%s, want blocked/blocked", result.Status, result.StopReason)
	}
	if !blockedReasonContains(result, "basic_attack_cast_blocked") {
		t.Fatalf("blockedReasons = %v, want basic_attack_cast_blocked", result.BlockedReasons)
	}
	if result.AttackCount != 0 || len(result.DamageTimeline) != 0 {
		t.Fatalf("disarmed curve should not record attacks or damage: attacks=%d timeline=%d", result.AttackCount, len(result.DamageTimeline))
	}
}

func TestSingleAttackerDPSMultipleCurvesIsolateOKAndBlockedResults(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	blockedCurve := input.Curves[0]
	blockedCurve.CurveID = "missing-passive"
	blockedCurve.Selection.EnabledPassiveEffects = []string{"missing_passive"}
	blockedCurve.ResolvedSnapshot.EnabledPassiveEffects = []string{"missing_passive"}
	input.Curves = append(input.Curves, blockedCurve)

	output := runSingleAttackerDPSForTest(t, input)
	if len(output.CurveResults) != 2 {
		t.Fatalf("curveResults length = %d, want 2", len(output.CurveResults))
	}
	if output.CurveResults[0].Status != "ok" || output.CurveResults[0].TotalDamage <= 0 {
		t.Fatalf("first curve = %+v, want independent ok result", output.CurveResults[0])
	}
	if output.CurveResults[1].Status != "blocked" || len(output.CurveResults[1].BlockedReasons) == 0 || output.CurveResults[1].TotalDamage != 0 {
		t.Fatalf("second curve = %+v, want blocked without synthesized damage", output.CurveResults[1])
	}
}

func TestSessionBeginRunJSONDispatchesSingleAttackerDPSDoneFrame(t *testing.T) {
	session := NewSession()
	if code := session.InitJSON(mustJSONForDPSTest(t, dpsTestEngineBundle())); code != 0 {
		t.Fatalf("InitJSON code = %d", code)
	}
	if code := session.BeginRunJSON(mustJSONForDPSTest(t, baseSingleAttackerDPSInput())); code != 0 {
		t.Fatalf("BeginRunJSON code = %d", code)
	}
	output := lastDPSOutput(t, session.OutboxBytes())
	if output.CaseID != "V2-BatchA-basic-aa-001" || len(output.CurveResults) != 1 || output.CurveResults[0].Status != "ok" {
		t.Fatalf("DPS done payload = %+v, want single_attacker_dps ok result", output)
	}
}

func TestSessionBeginRunJSONDispatchesMultiCurveDPSDoneFrame(t *testing.T) {
	session := NewSession()
	if code := session.InitJSON(mustJSONForDPSTest(t, dpsTestEngineBundle())); code != 0 {
		t.Fatalf("InitJSON code = %d", code)
	}
	input := baseSingleAttackerDPSInput()
	baseCurve := input.Curves[0]
	input.Curves = make([]model.DPSCurveRunSpecV2, 6)
	for i := range input.Curves {
		curve := baseCurve
		curve.CurveID = "vayne-basic-aa-" + string(rune('a'+i))
		input.Curves[i] = curve
	}
	if code := session.BeginRunJSON(mustJSONForDPSTest(t, input)); code != 0 {
		t.Fatalf("BeginRunJSON code = %d, want 0 with non-empty outbox", code)
	}
	outbox := session.OutboxBytes()
	if len(outbox) == 0 {
		t.Fatal("outbox is empty after multi-curve DPS begin_run")
	}
	output := lastDPSOutput(t, outbox)
	if len(output.CurveResults) != 6 {
		t.Fatalf("curveResults length = %d, want 6", len(output.CurveResults))
	}
	for i, result := range output.CurveResults {
		if result.Status != "ok" {
			t.Fatalf("curveResults[%d] = %+v, want ok", i, result)
		}
	}
}

func TestSessionBeginRunJSONDispatchesEquipmentSetDPSDoneFrame(t *testing.T) {
	session := NewSession()
	if code := session.InitJSON(mustJSONForDPSTest(t, dpsTestEngineBundle())); code != 0 {
		t.Fatalf("InitJSON code = %d", code)
	}
	input := baseSingleAttackerDPSInput()
	input.Curves[0].Selection.EquipmentSet = []string{"3031", "3046"}
	input.Curves[0].ResolvedSnapshot.EquipmentSet = []string{"3031", "3046"}
	input.Curves[0].ResolvedSnapshot.EquipmentStats = map[string]float64{
		"ad":           75,
		"attack_speed": 0.65,
	}
	if code := session.BeginRunJSON(mustJSONForDPSTest(t, input)); code != 0 {
		t.Fatalf("BeginRunJSON code = %d", code)
	}
	output := lastDPSOutput(t, session.OutboxBytes())
	if len(output.CurveResults) != 1 {
		t.Fatalf("curveResults length = %d, want 1", len(output.CurveResults))
	}
	result := output.CurveResults[0]
	if result.Status != "ok" || result.AttackCount != 14 || !almostEqual(result.TotalDamage, 945) {
		t.Fatalf("equipment DPS result = %+v, want ok with merged equipment stats", result)
	}
}

func TestSingleAttackerDPSVayneSilverBoltsEveryThirdHit(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 2501
	curve := &input.Curves[0]
	curve.CurveID = "vayne-silver-bolts"
	curve.Selection.EnabledPassiveEffects = []string{"skill_vayne_w_silver_bolts"}
	curve.ResolvedSnapshot.EnabledPassiveEffects = []string{"skill_vayne_w_silver_bolts"}
	curve.ResolvedSnapshot.PassiveEffects = []model.DPSPassiveEffectV2{vayneSilverBoltsPassive()}
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 0
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 3000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 3000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["hp"] = 3000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("result = %+v, want ok", result)
	}
	if result.AttackCount != 3 {
		t.Fatalf("attackCount = %d, want 3", result.AttackCount)
	}
	if !almostEqual(result.DamageByType["true"], 300) || !almostEqual(result.TotalDamage, 300) {
		t.Fatalf("damageByType=%v total=%.2f, want 300 true damage", result.DamageByType, result.TotalDamage)
	}
	if len(result.SkillPassiveTriggers) != 1 || result.SkillPassiveTriggers[0].TimeMs != 2000 {
		t.Fatalf("skillPassiveTriggers = %+v, want one third-hit trigger at 2000ms", result.SkillPassiveTriggers)
	}
	if len(result.EffectBreakdown) == 0 {
		t.Fatal("effectBreakdown should record passive true damage")
	}
}

func TestSingleAttackerDPSTeemoToxicShotOnHitAndDoT(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 4500
	curve := &input.Curves[0]
	curve.CurveID = "teemo-toxic-shot"
	curve.Selection.HeroID = "hero_teemo"
	curve.Selection.EnabledPassiveEffects = []string{"skill_teemo_e_toxic_shot"}
	curve.ResolvedSnapshot.EnabledPassiveEffects = []string{"skill_teemo_e_toxic_shot"}
	curve.ResolvedSnapshot.PassiveEffects = []model.DPSPassiveEffectV2{teemoToxicShotPassive()}
	curve.ResolvedSnapshot.AttackerSnapshot.ActorID = "hero_teemo"
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 0
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 0.2
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["hp"] = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("result = %+v, want ok", result)
	}
	if result.AttackCount != 1 {
		t.Fatalf("attackCount = %d, want 1", result.AttackCount)
	}
	if !almostEqual(result.DamageByType["magic"], 30) || !almostEqual(result.TotalDamage, 30) {
		t.Fatalf("damageByType=%v total=%.2f, want 10 on-hit + 20 DoT magic", result.DamageByType, result.TotalDamage)
	}
	if got := damageCountBySource(result, "teemo_e_dot"); got != 4 {
		t.Fatalf("teemo dot tick count = %d, want 4", got)
	}
}

func TestSingleAttackerDPSBlocksDotTickIntervalOverride(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	curve := &input.Curves[0]
	curve.CurveID = "dot-tick-override"
	curve.Selection.EnabledPassiveEffects = []string{"skill_teemo_e_toxic_shot"}
	curve.ResolvedSnapshot.EnabledPassiveEffects = []string{"skill_teemo_e_toxic_shot"}
	passive := teemoToxicShotPassive()
	passive.Operations[1].TickIntervalMs = 500
	curve.ResolvedSnapshot.PassiveEffects = []model.DPSPassiveEffectV2{passive}

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "blocked" || result.StopReason != "blocked" {
		t.Fatalf("status/stopReason = %s/%s, want blocked/blocked", result.Status, result.StopReason)
	}
	if !blockedReasonContains(result, "tickIntervalMs override") {
		t.Fatalf("blockedReasons = %v, want tickIntervalMs override reason", result.BlockedReasons)
	}
}

func TestSingleAttackerDPSBlocksUnsupportedDotRefreshMode(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	curve := &input.Curves[0]
	curve.CurveID = "dot-refresh-mode"
	curve.Selection.EnabledPassiveEffects = []string{"skill_teemo_e_toxic_shot"}
	curve.ResolvedSnapshot.EnabledPassiveEffects = []string{"skill_teemo_e_toxic_shot"}
	passive := teemoToxicShotPassive()
	passive.Operations[1].RefreshMode = "extend"
	curve.ResolvedSnapshot.PassiveEffects = []model.DPSPassiveEffectV2{passive}

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "blocked" || result.StopReason != "blocked" {
		t.Fatalf("status/stopReason = %s/%s, want blocked/blocked", result.Status, result.StopReason)
	}
	if !blockedReasonContains(result, "unsupported refreshMode") {
		t.Fatalf("blockedReasons = %v, want unsupported refreshMode reason", result.BlockedReasons)
	}
}

func TestSingleAttackerDPSVarusBlightedQuiverOnHitAndStacks(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 2100
	curve := &input.Curves[0]
	curve.CurveID = "varus-blighted-quiver"
	curve.Selection.HeroID = "hero_varus"
	curve.Selection.EnabledPassiveEffects = []string{"skill_varus_w_blighted_quiver"}
	curve.ResolvedSnapshot.EnabledPassiveEffects = []string{"skill_varus_w_blighted_quiver"}
	curve.ResolvedSnapshot.PassiveEffects = []model.DPSPassiveEffectV2{varusBlightedQuiverPassive()}
	curve.ResolvedSnapshot.AttackerSnapshot.ActorID = "hero_varus"
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 0
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("result = %+v, want ok", result)
	}
	if result.AttackCount != 3 || !almostEqual(result.DamageByType["magic"], 24) {
		t.Fatalf("attackCount=%d damageByType=%v, want 3 attacks and 24 magic", result.AttackCount, result.DamageByType)
	}
	if !hasBreakdown(result, dpsOpAddStack, 3) {
		t.Fatalf("effectBreakdown = %+v, want third Blight stack", result.EffectBreakdown)
	}
}

func TestSingleAttackerDPSKaisaPlasmaStacksAndTriggerDamage(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 4001
	curve := &input.Curves[0]
	curve.CurveID = "kaisa-plasma"
	curve.Selection.HeroID = "hero_kaisa"
	curve.Selection.EnabledPassiveEffects = []string{"skill_kaisa_p_plasma"}
	curve.ResolvedSnapshot.EnabledPassiveEffects = []string{"skill_kaisa_p_plasma"}
	curve.ResolvedSnapshot.PassiveEffects = []model.DPSPassiveEffectV2{kaisaPlasmaPassive()}
	curve.ResolvedSnapshot.AttackerSnapshot.ActorID = "hero_kaisa"
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 59
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["hp"] = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("result = %+v, want ok", result)
	}
	if result.AttackCount != 5 || !almostEqual(result.DamageByType["physical"], 295) || !almostEqual(result.DamageByType["magic"], 68.7) {
		t.Fatalf("attackCount=%d damageByType=%v, want 5 attacks, 295 physical, 68.7 magic", result.AttackCount, result.DamageByType)
	}
	if !almostEqual(lastTargetHPAfterTime(result, 3000), 742) || !almostEqual(lastTargetHPAfterTime(result, 4000), 636.3) {
		t.Fatalf("damageTimeline = %+v, want HP 742 after 4 stacks and 636.3 after 5th trigger", result.DamageTimeline)
	}
	if !hasBreakdown(result, dpsOpTriggerDamageAtStacks, 38.7) {
		t.Fatalf("effectBreakdown = %+v, want Plasma trigger damage", result.EffectBreakdown)
	}
}

func TestSingleAttackerDPSTwitchDeadlyVenomStacksAndDoT(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 3500
	curve := &input.Curves[0]
	curve.CurveID = "twitch-deadly-venom"
	curve.Selection.HeroID = "hero_twitch"
	curve.Selection.EnabledPassiveEffects = []string{"skill_twitch_p_deadly_venom"}
	curve.ResolvedSnapshot.EnabledPassiveEffects = []string{"skill_twitch_p_deadly_venom"}
	curve.ResolvedSnapshot.PassiveEffects = []model.DPSPassiveEffectV2{twitchDeadlyVenomPassive()}
	curve.ResolvedSnapshot.AttackerSnapshot.ActorID = "hero_twitch"
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 0
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("result = %+v, want ok", result)
	}
	if result.AttackCount != 4 || !almostEqual(result.DamageByType["true"], 12) {
		t.Fatalf("attackCount=%d damageByType=%v, want 4 attacks and 12 true DoT", result.AttackCount, result.DamageByType)
	}
	if got := damageCountBySource(result, "twitch_p_dot"); got != 3 {
		t.Fatalf("twitch dot tick count = %d, want 3", got)
	}
}

func TestSingleAttackerDPSKogMawQPassiveAndWScenarioState(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1001
	scenario := model.DPSScenarioStateV2{
		StateID:     "kogmaw_w_pre_enabled",
		SourceType:  "skill_passive",
		SourceID:    "skill_kogmaw_w_bio_arcane_barrage",
		Activation:  "assumed_active_at_start",
		Stacks:      1,
		StartTimeMs: 0,
		DurationMs:  8000,
	}
	curve := &input.Curves[0]
	curve.CurveID = "kogmaw-q-w"
	curve.Selection.HeroID = "hero_kogmaw"
	curve.Selection.EnabledPassiveEffects = []string{"skill_kogmaw_q_caustic_spittle_passive", "skill_kogmaw_w_bio_arcane_barrage"}
	curve.Selection.ScenarioStates = []model.DPSScenarioStateV2{scenario}
	curve.ResolvedSnapshot.EnabledPassiveEffects = []string{"skill_kogmaw_q_caustic_spittle_passive", "skill_kogmaw_w_bio_arcane_barrage"}
	curve.ResolvedSnapshot.ScenarioStates = []model.DPSScenarioStateV2{scenario}
	curve.ResolvedSnapshot.PassiveEffects = []model.DPSPassiveEffectV2{kogMawQPassiveAttackSpeed(), kogMawWScenarioPassive()}
	curve.ResolvedSnapshot.AttackerSnapshot.ActorID = "hero_kogmaw"
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 0
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["hp"] = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("result = %+v, want ok", result)
	}
	if result.AttackCount != 3 {
		t.Fatalf("attackCount = %d, want 3 attacks at 2.0 AS", result.AttackCount)
	}
	if got := result.AttackIntervalTimeline[0]; got.RawAttackSpeed != 2 || got.AttackIntervalMs != 500 {
		t.Fatalf("first interval = %+v, want raw AS 2 interval 500", got)
	}
	if !almostEqual(result.DamageByType["magic"], 90) {
		t.Fatalf("damageByType=%v, want three W hits for 90 magic", result.DamageByType)
	}
}

func TestSingleAttackerDPSNextAttackStateFiresOnceWithEvidence(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 2500
	stateID := "spellblade_ready"
	scenario := spellbladeScenarioState(stateID, 0, 8000)
	passive := spellbladeNextAttackPassive(stateID)
	curve := &input.Curves[0]
	curve.CurveID = "spellblade-next-attack-once"
	enableDPSPassivesForTest(curve, passive)
	curve.Selection.ScenarioStates = []model.DPSScenarioStateV2{scenario}
	curve.ResolvedSnapshot.ScenarioStates = []model.DPSScenarioStateV2{scenario}
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if result.AttackCount != 3 {
		t.Fatalf("attackCount = %d, want 3", result.AttackCount)
	}
	if got := damageCountBySource(result, "spellblade_proc"); got != 1 {
		t.Fatalf("spellblade_proc damage count = %d, want 1", got)
	}
	if len(result.ItemPassiveTriggers) != 1 {
		t.Fatalf("itemPassiveTriggers = %+v, want one proc", result.ItemPassiveTriggers)
	}
	if !hasEffectBreakdown(result, dpsOpDamage, "spellblade_proc", 100) {
		t.Fatalf("effectBreakdown = %+v, want spellblade_proc damage evidence", result.EffectBreakdown)
	}
	if !effectBreakdownMessageContains(result, dpsEffectNextAttackStateConsume, "consumedScenarioStateId="+stateID) {
		t.Fatalf("effectBreakdown = %+v, want consume evidence for %s", result.EffectBreakdown, stateID)
	}
}

func TestSingleAttackerDPSNextAttackStateLongDurationTriggersOnceOnly(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 2500
	stateID := "spellblade_ready"
	scenario := spellbladeScenarioState(stateID, 0, 10000)
	passive := spellbladeNextAttackPassive(stateID)
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, passive)
	curve.Selection.ScenarioStates = []model.DPSScenarioStateV2{scenario}
	curve.ResolvedSnapshot.ScenarioStates = []model.DPSScenarioStateV2{scenario}
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if got := damageCountBySource(result, "spellblade_proc"); got != 1 {
		t.Fatalf("spellblade_proc damage count = %d, want 1 even while scenario state duration remains active", got)
	}
	if len(result.ItemPassiveTriggers) != 1 {
		t.Fatalf("itemPassiveTriggers = %+v, want one proc", result.ItemPassiveTriggers)
	}
}

func TestSingleAttackerDPSNextAttackStateBlocksMissingRequiresScenarioStateID(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	passive := spellbladeNextAttackPassive("")
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, passive)

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "blocked" {
		t.Fatalf("status = %s, want blocked", result.Status)
	}
	if !blockedReasonContains(result, "next_basic_attack_after_state") || !blockedReasonContains(result, "requiresScenarioStateId") {
		t.Fatalf("blockedReasons = %v, want next_basic_attack_after_state and requiresScenarioStateId", result.BlockedReasons)
	}
}

func TestSingleAttackerDPSNextAttackStateBlocksMissingResolvedScenarioState(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	passive := spellbladeNextAttackPassive("spellblade_missing")
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, passive)

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "blocked" {
		t.Fatalf("status = %s, want blocked", result.Status)
	}
	if !blockedReasonContains(result, "scenarioState") || !blockedReasonContains(result, "spellblade_missing") {
		t.Fatalf("blockedReasons = %v, want scenarioState evidence and missing state id spellblade_missing", result.BlockedReasons)
	}
}

func TestSingleAttackerDPSNextAttackStateDoesNotFireAfterStateExpires(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 2500
	stateID := "spellblade_ready"
	// Active only during (500ms, 900ms); first basic attack at 1000ms sees an expired state.
	scenario := spellbladeScenarioState(stateID, 500, 400)
	passive := spellbladeNextAttackPassive(stateID)
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, passive)
	curve.Selection.ScenarioStates = []model.DPSScenarioStateV2{scenario}
	curve.ResolvedSnapshot.ScenarioStates = []model.DPSScenarioStateV2{scenario}
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if got := damageCountBySource(result, "spellblade_proc"); got != 0 {
		t.Fatalf("spellblade_proc damage count = %d, want 0 after scenario state expired before first eligible attack", got)
	}
	if len(result.ItemPassiveTriggers) != 0 {
		t.Fatalf("itemPassiveTriggers = %+v, want no proc after state expiry", result.ItemPassiveTriggers)
	}
}

func TestSingleAttackerDPSNextAttackStateRespectsScenarioTiming(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 3500
	stateID := "spellblade_ready"
	scenario := spellbladeScenarioState(stateID, 1000, 5000)
	passive := spellbladeNextAttackPassive(stateID)
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, passive)
	curve.Selection.ScenarioStates = []model.DPSScenarioStateV2{scenario}
	curve.ResolvedSnapshot.ScenarioStates = []model.DPSScenarioStateV2{scenario}
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if got := damageTimesBySource(result, "spellblade_proc"); !sameInt64s(got, []int64{1000}) {
		t.Fatalf("spellblade_proc times = %v, want first eligible attack at 1000ms", got)
	}
}

func TestSingleAttackerDPSNextAttackStatePhantomHitDoesNotDuplicate(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 4000
	stateID := "spellblade_ready"
	scenario := spellbladeScenarioState(stateID, 0, 8000)
	spellblade := spellbladeNextAttackPassive(stateID)
	spellblade.Operations[0].PhantomHitCopyable = true
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, spellblade, testPhantomHitPassive())
	curve.Selection.ScenarioStates = []model.DPSScenarioStateV2{scenario}
	curve.ResolvedSnapshot.ScenarioStates = []model.DPSScenarioStateV2{scenario}
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if got := damageCountBySource(result, "spellblade_proc"); got != 1 {
		t.Fatalf("spellblade_proc damage count = %d, want 1 without phantom duplication", got)
	}
	fourthHitMs := int64(3000)
	if !hasPhantomItemTriggerAt(result, fourthHitMs, "phantom_hit") {
		t.Fatalf("itemPassiveTriggers = %+v, want phantom hit evidence on fourth attack", result.ItemPassiveTriggers)
	}
}

func TestSingleAttackerDPSNextAttackStateDoesNotChangeCadence(t *testing.T) {
	baselineInput := baseSingleAttackerDPSInput()
	baselineInput.SimulationRules.DurationMs = 2500
	baselineCurve := &baselineInput.Curves[0]
	baselineCurve.CurveID = "spellblade-cadence-baseline"
	baselineCurve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	baselineCurve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	baselineCurve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000

	spellbladeInput := baseSingleAttackerDPSInput()
	spellbladeInput.SimulationRules.DurationMs = 2500
	spellbladeInput.CaseID = "spellblade-cadence-with-proc"
	stateID := "spellblade_ready"
	scenario := spellbladeScenarioState(stateID, 0, 8000)
	passive := spellbladeNextAttackPassive(stateID)
	spellbladeCurve := &spellbladeInput.Curves[0]
	spellbladeCurve.CurveID = "spellblade-cadence-with-proc"
	spellbladeCurve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	spellbladeCurve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	spellbladeCurve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	enableDPSPassivesForTest(spellbladeCurve, passive)
	spellbladeCurve.Selection.ScenarioStates = []model.DPSScenarioStateV2{scenario}
	spellbladeCurve.ResolvedSnapshot.ScenarioStates = []model.DPSScenarioStateV2{scenario}

	baseline := runSingleAttackerDPSForTest(t, baselineInput).CurveResults[0]
	withSpellblade := runSingleAttackerDPSForTest(t, spellbladeInput).CurveResults[0]
	if baseline.Status != "ok" || withSpellblade.Status != "ok" {
		t.Fatalf("status baseline=%s spellblade=%s, want ok", baseline.Status, withSpellblade.Status)
	}
	if baseline.AttackCount != withSpellblade.AttackCount {
		t.Fatalf("attackCount baseline=%d spellblade=%d, want unchanged cadence", baseline.AttackCount, withSpellblade.AttackCount)
	}
	if !sameInt64s(attackTimes(baseline), attackTimes(withSpellblade)) {
		t.Fatalf("attack times baseline=%v spellblade=%v, want identical cadence", attackTimes(baseline), attackTimes(withSpellblade))
	}
	if !sameFloat64s(rawAttackSpeeds(baseline), rawAttackSpeeds(withSpellblade)) {
		t.Fatalf("raw attack speeds baseline=%v spellblade=%v, want identical interval evidence", rawAttackSpeeds(baseline), rawAttackSpeeds(withSpellblade))
	}
}

func TestSingleAttackerDPSCanonicalBuffExpiresAtNextAttackBoundary(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.CaseID = "V2-BatchF-F1-buff-boundary"
	input.SimulationRules.DurationMs = 2000
	scenario := model.DPSScenarioStateV2{
		StateID:     "canonical_as_buff",
		SourceType:  "skill_passive",
		SourceID:    "canonical_as_buff",
		Activation:  "assumed_active_at_start",
		Stacks:      1,
		StartTimeMs: 0,
		DurationMs:  500,
	}
	passive := canonicalAttackSpeedBuffPassive("canonical_as_buff")
	curve := &input.Curves[0]
	curve.CurveID = "canonical-buff-boundary"
	curve.Selection.EnabledPassiveEffects = []string{passive.PassiveID}
	curve.Selection.ScenarioStates = []model.DPSScenarioStateV2{scenario}
	curve.ResolvedSnapshot.EnabledPassiveEffects = []string{passive.PassiveID}
	curve.ResolvedSnapshot.ScenarioStates = []model.DPSScenarioStateV2{scenario}
	curve.ResolvedSnapshot.PassiveEffects = []model.DPSPassiveEffectV2{passive}
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 10
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if got := attackTimes(result); !sameInt64s(got, []int64{0, 500, 1500}) {
		t.Fatalf("attack times = %v, want first buffed interval then expired cadence 0/500/1500", got)
	}
	if len(result.AttackIntervalTimeline) != 3 {
		t.Fatalf("attackIntervalTimeline = %+v, want three interval evidence rows", result.AttackIntervalTimeline)
	}
	if got := result.AttackIntervalTimeline[0]; got.RawAttackSpeed != 2 || got.EffectiveAttackSpeed != 2 || got.AttackIntervalMs != 500 || got.NextAttackAtMs != 500 {
		t.Fatalf("first interval = %+v, want active buff raw/effective=2 interval=500", got)
	}
	if got := result.AttackIntervalTimeline[1]; got.RawAttackSpeed != 1 || got.EffectiveAttackSpeed != 1 || got.AttackIntervalMs != 1000 || got.NextAttackAtMs != 1500 {
		t.Fatalf("second interval = %+v, want buff expired at boundary and base interval=1000", got)
	}
	if !hasBreakdown(result, dpsOpStatModifier, 2) {
		t.Fatalf("effectBreakdown = %+v, want initial stat modifier evidence", result.EffectBreakdown)
	}
}

func TestSingleAttackerDPSCanonicalAttackSpeedCapBoundary(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.CaseID = "V2-BatchF-F2-as-cap"
	input.SimulationRules.DurationMs = 1000
	base := input.Curves[0]
	base.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 1
	base.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	base.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	base.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	base.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0
	input.Curves = []model.DPSCurveRunSpecV2{
		canonicalAttackSpeedCurve(base, "as-2.99", 2.99),
		canonicalAttackSpeedCurve(base, "as-3.00", 3.0),
		canonicalAttackSpeedCurve(base, "as-3.01", 3.01),
	}

	output := runSingleAttackerDPSForTest(t, input)
	if len(output.CurveResults) != 3 {
		t.Fatalf("curveResults length = %d, want 3", len(output.CurveResults))
	}
	want := []struct {
		raw       float64
		effective float64
		overflow  float64
		interval  int64
	}{
		{raw: 2.99, effective: 2.99, overflow: 0, interval: 334},
		{raw: 3.0, effective: 3.0, overflow: 0, interval: 333},
		{raw: 3.01, effective: 3.0, overflow: 0.01, interval: 333},
	}
	for i, result := range output.CurveResults {
		if result.Status != "ok" {
			t.Fatalf("curve %d status=%s blockedReasons=%v, want ok", i, result.Status, result.BlockedReasons)
		}
		if len(result.AttackIntervalTimeline) == 0 {
			t.Fatalf("curve %d missing attackIntervalTimeline", i)
		}
		got := result.AttackIntervalTimeline[0]
		if !almostEqual(got.RawAttackSpeed, want[i].raw) ||
			!almostEqual(got.EffectiveAttackSpeed, want[i].effective) ||
			!almostEqual(got.OverflowAttackSpeed, want[i].overflow) ||
			got.AttackIntervalMs != want[i].interval {
			t.Fatalf("curve %d interval = %+v, want raw %.2f effective %.2f overflow %.2f interval %d", i, got, want[i].raw, want[i].effective, want[i].overflow, want[i].interval)
		}
	}
}

func TestSingleAttackerDPSCanonicalDotTicksAtExpireBoundary(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.CaseID = "V2-BatchF-F3-dot-expire"
	input.SimulationRules.DurationMs = 4001
	passive := canonicalDotOnlyPassive()
	curve := &input.Curves[0]
	curve.CurveID = "canonical-dot-expire"
	curve.Selection.EnabledPassiveEffects = []string{passive.PassiveID}
	curve.ResolvedSnapshot.EnabledPassiveEffects = []string{passive.PassiveID}
	curve.ResolvedSnapshot.PassiveEffects = []model.DPSPassiveEffectV2{passive}
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 0
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 0.1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if got := damageTimesBySource(result, "canonical_dot_tick"); !sameInt64s(got, []int64{1000, 2000, 3000, 4000}) {
		t.Fatalf("dot tick times = %v, want ticks including expireAt=4000", got)
	}
	if !hasEffectBreakdown(result, "dot_tick", "canonical_dot_tick", 5) {
		t.Fatalf("effectBreakdown = %+v, want dot_tick evidence at expire boundary", result.EffectBreakdown)
	}
}

func TestSingleAttackerDPSCanonicalSourceOrderForAttackPassivesAndDot(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.CaseID = "V2-BatchF-F4-source-order"
	input.SimulationRules.DurationMs = 1001
	heroPassive := canonicalHeroOnHitPassive()
	itemPassive := canonicalItemOnHitPassive()
	dotPassive := canonicalDotOnlyPassive()
	curve := &input.Curves[0]
	curve.CurveID = "canonical-source-order"
	curve.Selection.EnabledPassiveEffects = []string{heroPassive.PassiveID, itemPassive.PassiveID, dotPassive.PassiveID}
	curve.ResolvedSnapshot.EnabledPassiveEffects = []string{heroPassive.PassiveID, itemPassive.PassiveID, dotPassive.PassiveID}
	curve.ResolvedSnapshot.PassiveEffects = []model.DPSPassiveEffectV2{heroPassive, itemPassive, dotPassive}
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 0.1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if got := damageSources(result); !sameStrings(got, []string{dpsTestDefaultBasicAttackSkillID, "canonical_hero_on_hit", "canonical_item_on_hit", "canonical_dot_tick"}) {
		t.Fatalf("damage source order = %v, want basic -> hero -> item -> dot tick", got)
	}
	if got := effectBreakdownKindsAndSources(result); !sameStrings(got, []string{
		"damage:canonical_hero_on_hit",
		"damage:canonical_item_on_hit",
		"apply_dot:canonical_dot_tick",
		"dot_tick:canonical_dot_tick",
	}) {
		t.Fatalf("effectBreakdown order = %v, want hero -> item -> dot apply -> dot tick", got)
	}
}

func TestSingleAttackerDPSCanonicalBlockedCurveDoesNotPoisonBatch(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.CaseID = "V2-BatchF-F5-blocked-isolation"
	blockedCurve := input.Curves[0]
	blockedCurve.CurveID = "canonical-missing-passive"
	blockedCurve.Selection.EnabledPassiveEffects = []string{"canonical_missing_passive"}
	blockedCurve.ResolvedSnapshot.EnabledPassiveEffects = []string{"canonical_missing_passive"}
	input.Curves = append(input.Curves, blockedCurve)

	output := runSingleAttackerDPSForTest(t, input)
	if len(output.CurveResults) != 2 {
		t.Fatalf("curveResults length = %d, want 2", len(output.CurveResults))
	}
	okResult := output.CurveResults[0]
	blockedResult := output.CurveResults[1]
	if okResult.Status != "ok" || okResult.TotalDamage <= 0 || len(okResult.DamageTimeline) == 0 {
		t.Fatalf("first curve = %+v, want independent ok result", okResult)
	}
	if blockedResult.Status != "blocked" || blockedResult.StopReason != "blocked" || len(blockedResult.BlockedReasons) == 0 {
		t.Fatalf("second curve = %+v, want blocked with reasons", blockedResult)
	}
	if blockedResult.TotalDamage != 0 || len(blockedResult.DamageTimeline) != 0 || len(blockedResult.TargetHPTimeline) != 0 || len(blockedResult.EffectBreakdown) != 0 {
		t.Fatalf("blocked curve should expose safe empty evidence: %+v", blockedResult)
	}
}

func TestSingleAttackerDPSCanonicalCritPolicyExpectedAndUnsupportedRandom(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.CaseID = "V2-BatchF-F6-crit-policy"
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["crit_chance"] = 0.5
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["crit_damage"] = 2
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" || result.CritPolicy != "expected" || len(result.DamageTimeline) != 1 || !almostEqual(result.DamageTimeline[0].RawDamage, 150) {
		t.Fatalf("expected crit result = %+v, want expected raw basic attack damage 150", result)
	}

	input.SimulationRules.CritPolicy = "seeded_random"
	result = runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "blocked" || result.CritPolicy != "seeded_random" {
		t.Fatalf("seeded random result = %+v, want explicit blocked unsupported policy", result)
	}
	if !blockedReasonContains(result, "critPolicy=expected") {
		t.Fatalf("blockedReasons = %v, want supported crit policy reason", result.BlockedReasons)
	}
}

func TestSingleAttackerDPSStackingStatModifierOnHitAffectsCadenceAndCaps(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.CaseID = "V2-BatchH-H1-stacking-stat-cadence"
	input.SimulationRules.DurationMs = 1800
	passive := canonicalStackingStatModifierPassive("canonical_stacking_stat", "canonical_stack", 6000, 3, 0.5, 10)
	curve := &input.Curves[0]
	curve.CurveID = "stacking-stat-cadence"
	enableDPSPassivesForTest(curve, passive)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 10
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if got := attackTimes(result); !sameInt64s(got, []int64{0, 667, 1167, 1567}) {
		t.Fatalf("attack times = %v, want stack-modified cadence after first hit", got)
	}
	if got := rawAttackSpeeds(result); !sameFloat64s(got, []float64{1.5, 2.0, 2.5, 2.5}) {
		t.Fatalf("raw attack speeds = %v, want per-stack AS capped at 3 stacks", got)
	}
	if got := rawDamagesBySource(result, dpsTestDefaultBasicAttackSkillID); len(got) < 2 || !almostEqual(got[0], 10) || !almostEqual(got[1], 20) {
		t.Fatalf("basic raw damages = %v, want first attack unmodified and second attack with one stack", got)
	}
	if maxBreakdownAmount(result, dpsOpAddStack) != 3 {
		t.Fatalf("effectBreakdown = %+v, want add_stack evidence capped at 3", result.EffectBreakdown)
	}
	if !effectBreakdownMessageContains(result, dpsOpStatModifier, "perStack=true stackKey=canonical_stack stacks=3") {
		t.Fatalf("effectBreakdown = %+v, want per-stack stat modifier evidence", result.EffectBreakdown)
	}
}

func TestSingleAttackerDPSStackingStatModifierExpiresBeforeNextHit(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.CaseID = "V2-BatchH-H1-stacking-stat-expire"
	input.SimulationRules.DurationMs = 1100
	passive := canonicalStackingStatModifierPassive("canonical_expiring_stacking_stat", "expiring_stack", 200, 5, 1.0, 10)
	curve := &input.Curves[0]
	curve.CurveID = "stacking-stat-expires"
	enableDPSPassivesForTest(curve, passive)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 10
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if got := attackTimes(result); !sameInt64s(got, []int64{0, 500, 1000}) {
		t.Fatalf("attack times = %v, want scheduled next attack not rescheduled by expiry", got)
	}
	if got := rawDamagesBySource(result, dpsTestDefaultBasicAttackSkillID); !sameFloat64s(got, []float64{10, 10, 10}) {
		t.Fatalf("basic raw damages = %v, want expired stack lazily cleared before each next hit", got)
	}
	if result.ProcessedEvents != result.AttackCount {
		t.Fatalf("processedEvents=%d attackCount=%d, want no independent expiry event", result.ProcessedEvents, result.AttackCount)
	}
	if got := rawAttackSpeeds(result); !sameFloat64s(got, []float64{2, 2, 2}) {
		t.Fatalf("raw attack speeds = %v, want each hit to regain exactly one fresh stack", got)
	}
}

func TestSingleAttackerDPSBlocksInvalidStackingStatModifierContracts(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*model.DPSPassiveEffectV2)
		needle string
	}{
		{
			name: "per-stack stat modifier missing stack key",
			mutate: func(passive *model.DPSPassiveEffectV2) {
				passive.Operations[1].StackKey = ""
			},
			needle: "perStack stat_modifier requires stackKey",
		},
		{
			name: "per-stack stat modifier missing matching add stack",
			mutate: func(passive *model.DPSPassiveEffectV2) {
				passive.Operations[1].StackKey = "missing_stack"
			},
			needle: "requires matching add_stack",
		},
		{
			name: "unsupported add stack refresh mode",
			mutate: func(passive *model.DPSPassiveEffectV2) {
				passive.Operations[0].RefreshMode = "extend"
			},
			needle: "add_stack has unsupported refreshMode extend",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			input := baseSingleAttackerDPSInput()
			passive := canonicalStackingStatModifierPassive("canonical_invalid_stacking_stat", "invalid_stack", 6000, 3, 0.5, 0)
			tc.mutate(&passive)
			curve := &input.Curves[0]
			enableDPSPassivesForTest(curve, passive)

			result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
			if result.Status != "blocked" || result.StopReason != "blocked" {
				t.Fatalf("result = %+v, want blocked", result)
			}
			if !blockedReasonContains(result, tc.needle) {
				t.Fatalf("blockedReasons = %v, want %q", result.BlockedReasons, tc.needle)
			}
		})
	}
}

func testPhantomHitPassive() model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:      "test_phantom_hit_passive",
		SourceCategory: "item_passive",
		SourceID:       "test_phantom_hit_item",
		SourceType:     "item",
		TriggerID:      "test_phantom_on_hit",
		TriggerKind:    dpsTriggerOnBasicAttackHit,
		Operations: []model.DPSPassiveOperationV2{
			{Kind: dpsOpAddStack, Source: "test_phantom_stack", StackKey: "test_phantom_stack", MaxStacks: 4, RefreshMode: "refresh"},
			{Kind: dpsOpDamage, Source: "test_copyable_on_hit", DamageType: "magic", Amount: 25, PhantomHitCopyable: true},
			{
				Kind:          dpsOpPhantomHitOnHitRepeat,
				Source:        "test_phantom_repeat",
				StackKey:      "test_phantom_stack",
				TriggerStacks: 4,
				RepeatCount:   1,
				RepeatTag:     "phantom_hit",
				RepeatScope:   dpsRepeatScopeCopyableOnHit,
			},
		},
	}
}

func guinsoosPhantomHitPassive() model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:      "item_3124_guinsoos_rageblade_wrath_dps_v2",
		SourceCategory: "item_passive",
		SourceID:       "item_3124_guinsoos_rageblade",
		SourceType:     "item",
		TriggerID:      "guinsoos_wrath_on_hit",
		TriggerKind:    dpsTriggerOnBasicAttackHit,
		Operations: []model.DPSPassiveOperationV2{
			{Kind: dpsOpAddStack, Source: "guinsoos_boiling_strike_stack", StackKey: "guinsoos_boiling_strike", MaxStacks: 4, RefreshMode: "refresh"},
			{Kind: dpsOpStatModifier, Source: "guinsoos_boiling_strike_as", StackKey: "guinsoos_boiling_strike", AttrKey: "attack_speed", ModifierMode: "percent", Value: 0.08, PerStack: true},
			{Kind: dpsOpDamage, Source: "guinsoos_wrath_on_hit", DamageType: "magic", Amount: 30, PhantomHitCopyable: true},
			{
				Kind:          dpsOpPhantomHitOnHitRepeat,
				Source:        "guinsoos_phantom_hit",
				StackKey:      "guinsoos_boiling_strike",
				TriggerStacks: 4,
				RepeatCount:   1,
				RepeatTag:     "phantom_hit",
				RepeatScope:   dpsRepeatScopeCopyableOnHit,
			},
		},
	}
}

func TestSingleAttackerDPSPhantomHitRepeatsCopyableOnHitDamage(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.CaseID = "V2-BatchK-K1-phantom-hit-copyable-damage"
	input.SimulationRules.DurationMs = 2000
	curve := &input.Curves[0]
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 2
	enableDPSPassivesForTest(curve, testPhantomHitPassive())

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons = %v, want ok", result.Status, result.BlockedReasons)
	}
	fourthHitMs := result.AttackTimeline[3].TimeMs
	if result.AttackCount != 4 || len(result.AttackTimeline) != 4 {
		t.Fatalf("attackCount/timeline = %d/%d, want 4 attacks without phantom cadence", result.AttackCount, len(result.AttackTimeline))
	}
	if got := damageCountBySourceAt(result, "test_copyable_on_hit", fourthHitMs); got != 2 {
		t.Fatalf("copyable on-hit damage count at %dms = %d, want original + phantom", fourthHitMs, got)
	}
	if got := phantomDamageCountBySourceAt(result, "test_copyable_on_hit", fourthHitMs); got != 1 {
		t.Fatalf("phantom copyable damage count at %dms = %d, want 1", fourthHitMs, got)
	}
	if got := damageCountBySourceAt(result, "test_copyable_on_hit", 0); got != 1 {
		t.Fatalf("first hit copyable damage count = %d, want only original on-hit before trigger stacks", got)
	}
	if !hasPhantomItemTriggerAt(result, fourthHitMs, "phantom_hit") {
		t.Fatalf("itemPassiveTriggers = %+v, want phantom evidence at %dms", result.ItemPassiveTriggers, fourthHitMs)
	}
	if !hasPhantomEffectBreakdown(result, "test_copyable_on_hit", "phantom_hit") {
		t.Fatalf("effectBreakdown = %+v, want phantom-hit damage evidence", result.EffectBreakdown)
	}
	mitigatedOnHit := 25.0 * 100.0 / (100.0 + 80.0)
	if !almostEqual(result.DamageBySource["test_copyable_on_hit"], mitigatedOnHit*5) {
		t.Fatalf("damageBySource = %v, want 4 original + 1 phantom mitigated on-hit total", result.DamageBySource["test_copyable_on_hit"])
	}
}

func TestSingleAttackerDPSPhantomHitDoesNotRecurse(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.CaseID = "V2-BatchK-K1-phantom-hit-no-recursion"
	input.SimulationRules.DurationMs = 2000
	curve := &input.Curves[0]
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 2
	enableDPSPassivesForTest(curve, testPhantomHitPassive())

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s, want ok", result.Status)
	}
	fourthHitMs := result.AttackTimeline[3].TimeMs
	if got := phantomDamageCountBySourceAt(result, "test_copyable_on_hit", fourthHitMs); got != 1 {
		t.Fatalf("phantom damage count at trigger hit = %d, want exactly one copy", got)
	}
	if got := damageCountBySourceAt(result, "test_copyable_on_hit", fourthHitMs); got != 2 {
		t.Fatalf("total copyable damage at trigger hit = %d, want original + single phantom", got)
	}
	for _, event := range result.EffectBreakdown {
		if event.Kind == dpsOpPhantomHitOnHitRepeat {
			t.Fatalf("effectBreakdown must not replay phantom operation: %+v", event)
		}
	}
}

func TestSingleAttackerDPSPhantomHitDoesNotIncrementEveryNOrStacks(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.CaseID = "V2-BatchK-K1-phantom-hit-no-every-n-or-stack"
	input.SimulationRules.DurationMs = 2000
	curve := &input.Curves[0]
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 2
	enableDPSPassivesForTest(curve, testPhantomHitPassive(), krakenSlayerPassive())

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s, want ok", result.Status)
	}
	fourthHitMs := result.AttackTimeline[3].TimeMs
	thirdHitMs := result.AttackTimeline[2].TimeMs
	if got := addStackBreakdownCountAt(result, fourthHitMs); got != 1 {
		t.Fatalf("add_stack breakdown count at %dms = %d, want single stack increment", fourthHitMs, got)
	}
	if got := damageCountBySourceAt(result, "kraken_slayer_bring_it_down", fourthHitMs); got != 0 {
		t.Fatalf("kraken proc count at phantom trigger hit = %d, want every-N not advanced by phantom", got)
	}
	if got := damageCountBySourceAt(result, "kraken_slayer_bring_it_down", thirdHitMs); got != 1 {
		t.Fatalf("kraken proc count at 3rd hit = %d, want every-N still on cadence", got)
	}
}

func TestSingleAttackerDPSBlocksInvalidPhantomHitContracts(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*model.DPSPassiveEffectV2)
		needle string
	}{
		{
			name: "missing stack key",
			mutate: func(passive *model.DPSPassiveEffectV2) {
				passive.Operations[2].StackKey = ""
			},
			needle: "phantom_hit_on_hit_repeat requires stackKey",
		},
		{
			name: "trigger stacks not positive",
			mutate: func(passive *model.DPSPassiveEffectV2) {
				passive.Operations[2].TriggerStacks = 0
			},
			needle: "phantom_hit_on_hit_repeat requires triggerStacks > 0",
		},
		{
			name: "repeat count not one",
			mutate: func(passive *model.DPSPassiveEffectV2) {
				passive.Operations[2].RepeatCount = 2
			},
			needle: "phantom_hit_on_hit_repeat requires repeatCount=1",
		},
		{
			name: "missing repeat tag",
			mutate: func(passive *model.DPSPassiveEffectV2) {
				passive.Operations[2].RepeatTag = ""
			},
			needle: "phantom_hit_on_hit_repeat requires repeatTag",
		},
		{
			name: "unsupported repeat scope",
			mutate: func(passive *model.DPSPassiveEffectV2) {
				passive.Operations[2].RepeatScope = "all_on_hit"
			},
			needle: "phantom_hit_on_hit_repeat requires repeatScope=copyable_on_hit",
		},
		{
			name: "missing matching add stack",
			mutate: func(passive *model.DPSPassiveEffectV2) {
				passive.Operations[2].StackKey = "missing_stack"
			},
			needle: "phantom_hit_on_hit_repeat requires matching add_stack",
		},
		{
			name: "no copyable damage operation",
			mutate: func(passive *model.DPSPassiveEffectV2) {
				passive.Operations[1].PhantomHitCopyable = false
			},
			needle: "phantom_hit_on_hit_repeat requires at least one phantomHitCopyable damage operation",
		},
		{
			name: "copyable flag on non-damage operation",
			mutate: func(passive *model.DPSPassiveEffectV2) {
				passive.Operations[0].PhantomHitCopyable = true
			},
			needle: "phantomHitCopyable is only supported on damage operations",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			input := baseSingleAttackerDPSInput()
			passive := testPhantomHitPassive()
			tc.mutate(&passive)
			curve := &input.Curves[0]
			enableDPSPassivesForTest(curve, passive)

			result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
			if result.Status != "blocked" || result.StopReason != "blocked" {
				t.Fatalf("result = %+v, want blocked", result)
			}
			if !blockedReasonContains(result, tc.needle) {
				t.Fatalf("blockedReasons = %v, want %q", result.BlockedReasons, tc.needle)
			}
		})
	}
}

func TestSingleAttackerDPSGuinsooPhantomHitFixture(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.CaseID = "V2-BatchK-K1-guinsoo-phantom-hit-fixture"
	input.SimulationRules.DurationMs = 4000
	curve := &input.Curves[0]
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 2
	enableDPSPassivesForTest(curve, guinsoosPhantomHitPassive())

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons = %v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.AttackTimeline) < 4 {
		t.Fatalf("attack timeline = %+v, want at least 4 hits", result.AttackTimeline)
	}
	fourthHitMs := result.AttackTimeline[3].TimeMs
	if got := phantomDamageCountBySourceAt(result, "guinsoos_wrath_on_hit", fourthHitMs); got != 1 {
		t.Fatalf("phantom guinsoo on-hit count at %dms = %d, want 1", fourthHitMs, got)
	}
	if !hasPhantomItemTriggerAt(result, fourthHitMs, "phantom_hit") {
		t.Fatalf("itemPassiveTriggers = %+v, want phantom trigger evidence", result.ItemPassiveTriggers)
	}
	if !hasPhantomEffectBreakdown(result, "guinsoos_wrath_on_hit", "phantom_hit") {
		t.Fatalf("effectBreakdown = %+v, want guinsoo phantom-hit evidence", result.EffectBreakdown)
	}
	mitigatedOnHit := 30.0 * 100.0 / (100.0 + 80.0)
	if result.DamageBySource["guinsoos_wrath_on_hit"] <= mitigatedOnHit*4 {
		t.Fatalf("damageBySource guinsoos_wrath_on_hit = %.4f, want more than four hits worth including phantom copy", result.DamageBySource["guinsoos_wrath_on_hit"])
	}
}

func TestSingleAttackerDPSStackingStatModifierStackKeysArePassiveScoped(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.CaseID = "V2-BatchH-H1-stacking-stat-key-isolation"
	input.SimulationRules.DurationMs = 500
	first := canonicalStackingStatModifierPassive("canonical_stack_scope_a", "shared_stack", 6000, 5, 0.1, 0)
	second := canonicalStackingStatModifierPassive("canonical_stack_scope_b", "shared_stack", 6000, 5, 0.2, 0)
	curve := &input.Curves[0]
	curve.CurveID = "stacking-stat-scope"
	enableDPSPassivesForTest(curve, first, second)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 1
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if got := result.AttackIntervalTimeline[0].RawAttackSpeed; !almostEqual(got, 1.32) {
		t.Fatalf("first rawAttackSpeed = %.4f, want isolated shared_stack values 1.1*1.2=1.32", got)
	}
	if maxBreakdownAmount(result, dpsOpAddStack) != 1 {
		t.Fatalf("effectBreakdown = %+v, want each passive-scoped stack to stay at 1 after first hit", result.EffectBreakdown)
	}
}

func baseSingleAttackerDPSInput() model.SingleAttackerDPSInputV2 {
	return model.SingleAttackerDPSInputV2{
		CaseID:      "V2-BatchA-basic-aa-001",
		VersionCode: "test-version",
		SimulationRules: model.DPSimulationRulesV2{
			DurationMs:     10000,
			AttackSpeedCap: 3,
			CritPolicy:     "expected",
			AutoAttackPlan: model.DPSAutoAttackPlan{Enabled: true, StartAtMs: 0, TargetRole: "target"},
			MaxEvents:      10000,
		},
		TargetSnapshot: model.DPSActorSnapshotV2{
			ActorID:    "target_dummy_fighter",
			TemplateID: "target_dummy_fighter",
			Name:       "Target Dummy Fighter",
			Types:      []string{"target_dummy"},
			CurrentHP:  3000,
			MaxHP:      3000,
			Attributes: map[string]float64{"hp": 3000, "armor": 100, "magic_resist": 80},
		},
		Curves: []model.DPSCurveRunSpecV2{{
			CurveID: "vayne-basic-aa",
			Selection: model.DPSCurveSelectionV2{
				HeroID:                "Vayne",
				HeroLevel:             1,
				TargetID:              "target_dummy_fighter",
				TargetType:            "target_dummy",
				SkillLevels:           map[string]int{},
				EquipmentSet:          []string{},
				EnabledPassiveEffects: []string{},
				ScenarioStates:        []model.DPSScenarioStateV2{},
				CritPolicy:            "expected",
			},
			ResolvedSnapshot: model.DPSResolvedSnapshotV2{
				BasicAttackActions: []model.DPSBasicAttackActionRefV2{defaultDPSBasicAttackActionRef()},
				AttackerSnapshot: model.DPSActorSnapshotV2{
					ActorID:    "Vayne",
					TemplateID: "dps_attacker",
					Name:       "Vayne",
					Level:      1,
					Types:      []string{"champion"},
					CurrentHP:  550,
					MaxHP:      550,
					Attributes: map[string]float64{"hp": 550, "ad": 60, "attack_speed": 0.658},
				},
				TargetSnapshot: model.DPSActorSnapshotV2{
					ActorID:    "target_dummy_fighter",
					TemplateID: "target_dummy_fighter",
					Name:       "Target Dummy Fighter",
					Types:      []string{"target_dummy"},
					CurrentHP:  3000,
					MaxHP:      3000,
					Attributes: map[string]float64{"hp": 3000, "armor": 100, "magic_resist": 80},
				},
				EquipmentSet:           []string{},
				EquipmentStats:         map[string]float64{},
				EnabledPassiveEffects:  []string{},
				PassiveEffects:         []model.DPSPassiveEffectV2{},
				ExternalPassiveEffects: []string{},
				ScenarioStates:         []model.DPSScenarioStateV2{},
				RuneStatAdjustments:    map[string]float64{},
			},
		}},
	}
}

func almostEqual(left float64, right float64) bool {
	diff := left - right
	if diff < 0 {
		diff = -diff
	}
	return diff < 0.000001
}

func damageCountBySourceAt(result model.DPSCurveResultV2, source string, timeMs int64) int {
	count := 0
	for _, event := range result.DamageTimeline {
		if event.Source == source && event.TimeMs == timeMs {
			count++
		}
	}
	return count
}

func phantomDamageCountBySourceAt(result model.DPSCurveResultV2, source string, timeMs int64) int {
	count := 0
	for _, event := range result.DamageTimeline {
		if event.Source == source && event.TimeMs == timeMs && event.PhantomHit {
			count++
		}
	}
	return count
}

func hasPhantomItemTriggerAt(result model.DPSCurveResultV2, timeMs int64, repeatTag string) bool {
	for _, trigger := range result.ItemPassiveTriggers {
		if trigger.TimeMs == timeMs && trigger.PhantomHit && trigger.RepeatTag == repeatTag {
			return true
		}
	}
	return false
}

func hasPhantomEffectBreakdown(result model.DPSCurveResultV2, source string, repeatTag string) bool {
	for _, event := range result.EffectBreakdown {
		if event.Source == source && event.PhantomHit && event.RepeatTag == repeatTag && event.Kind == dpsOpDamage {
			return true
		}
	}
	return false
}

func addStackBreakdownCountAt(result model.DPSCurveResultV2, timeMs int64) int {
	count := 0
	for _, event := range result.EffectBreakdown {
		if event.TimeMs == timeMs && event.Kind == dpsOpAddStack {
			count++
		}
	}
	return count
}

func blockedReasonContains(result model.DPSCurveResultV2, needle string) bool {
	for _, reason := range result.BlockedReasons {
		if strings.Contains(reason, needle) {
			return true
		}
	}
	return false
}

func vayneSilverBoltsPassive() model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:      "skill_vayne_w_silver_bolts",
		SourceCategory: "skill_passive",
		SourceID:       "skill_vayne_w_silver_bolts",
		SourceType:     "skill",
		TriggerID:      "vayne_w_every_3_hit",
		TriggerKind:    dpsTriggerEveryNBasicAttack,
		EveryN:         3,
		Operations: []model.DPSPassiveOperationV2{{
			Kind:             dpsOpDamage,
			Source:           "vayne_w_true_damage",
			DamageType:       "true",
			TargetMaxHPRatio: 0.10,
		}},
	}
}

func teemoToxicShotPassive() model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:      "skill_teemo_e_toxic_shot",
		SourceCategory: "skill_passive",
		SourceID:       "skill_teemo_e_toxic_shot",
		SourceType:     "skill",
		TriggerID:      "teemo_e_on_hit",
		TriggerKind:    dpsTriggerOnBasicAttackHit,
		Operations: []model.DPSPassiveOperationV2{
			{Kind: dpsOpDamage, Source: "teemo_e_on_hit", DamageType: "magic", Amount: 10},
			{Kind: dpsOpApplyDot, Source: "teemo_e_dot", DamageType: "magic", Amount: 5, DurationMs: 4000, TickIntervalMs: 1000, RefreshMode: "refresh"},
		},
	}
}

func varusBlightedQuiverPassive() model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:      "skill_varus_w_blighted_quiver",
		SourceCategory: "skill_passive",
		SourceID:       "skill_varus_w_blighted_quiver",
		SourceType:     "skill",
		TriggerID:      "varus_w_on_hit",
		TriggerKind:    dpsTriggerOnBasicAttackHit,
		Operations: []model.DPSPassiveOperationV2{
			{Kind: dpsOpDamage, Source: "varus_w_on_hit", DamageType: "magic", Amount: 8},
			{Kind: dpsOpAddStack, Source: "varus_w_blight_stack", StackKey: "varus_blight", MaxStacks: 3, DurationMs: 6000},
		},
	}
}

func kaisaPlasmaPassive() model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:      "skill_kaisa_p_plasma",
		SourceCategory: "skill_passive",
		SourceID:       "skill_kaisa_p_plasma",
		SourceType:     "skill",
		TriggerID:      "kaisa_p_on_hit",
		TriggerKind:    dpsTriggerOnBasicAttackHit,
		Operations: []model.DPSPassiveOperationV2{
			{Kind: dpsOpAddStack, Source: "kaisa_p_plasma_stack", StackKey: "kaisa_plasma", MaxStacks: 5, DurationMs: 6000},
			{Kind: dpsOpDamage, Source: "kaisa_p_plasma_on_hit", DamageType: "magic", Amount: 3, AmountPerStack: 1, StackKey: "kaisa_plasma"},
			{Kind: dpsOpTriggerDamageAtStacks, Source: "kaisa_p_plasma_rupture", StackKey: "kaisa_plasma", TriggerStacks: 5, ResetStacks: true, DamageType: "magic", TargetMissingHPRatio: 0.15, TargetMissingHPBasis: "attack_start"},
		},
	}
}

func twitchDeadlyVenomPassive() model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:      "skill_twitch_p_deadly_venom",
		SourceCategory: "skill_passive",
		SourceID:       "skill_twitch_p_deadly_venom",
		SourceType:     "skill",
		TriggerID:      "twitch_p_on_hit",
		TriggerKind:    dpsTriggerOnBasicAttackHit,
		Operations: []model.DPSPassiveOperationV2{
			{Kind: dpsOpAddStack, Source: "twitch_p_stack", StackKey: "twitch_deadly_venom", MaxStacks: 6, DurationMs: 6000},
			{Kind: dpsOpApplyDot, Source: "twitch_p_dot", StackKey: "twitch_deadly_venom", DamageType: "true", AmountPerStack: 2, DurationMs: 6000, TickIntervalMs: 1000, RefreshMode: "refresh"},
		},
	}
}

func kogMawQPassiveAttackSpeed() model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:      "skill_kogmaw_q_caustic_spittle_passive",
		SourceCategory: "skill_passive",
		SourceID:       "skill_kogmaw_q_caustic_spittle_passive",
		SourceType:     "skill",
		TriggerID:      "kogmaw_q_stat_modifier",
		TriggerKind:    dpsTriggerStatAlwaysOn,
		Operations: []model.DPSPassiveOperationV2{{
			Kind:         dpsOpStatModifier,
			Source:       "kogmaw_q_attack_speed",
			AttrKey:      "attack_speed",
			ModifierMode: "percent",
			Value:        1.0,
		}},
	}
}

func spellbladeScenarioState(stateID string, startTimeMs int64, durationMs int64) model.DPSScenarioStateV2 {
	return model.DPSScenarioStateV2{
		StateID:     stateID,
		SourceType:  "item_passive",
		SourceID:    "item_spellblade_sheen",
		Activation:  "assumed_active_at_start",
		Stacks:      1,
		StartTimeMs: startTimeMs,
		DurationMs:  durationMs,
	}
}

func spellbladeNextAttackPassive(stateID string) model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:               "item_spellblade_sheen_next_attack",
		SourceCategory:          "item_passive",
		SourceID:                "item_spellblade_sheen",
		SourceType:              "item",
		TriggerID:               "spellblade_on_next_attack",
		TriggerKind:             dpsTriggerNextBasicAttackAfterState,
		RequiresScenarioStateID: stateID,
		Operations: []model.DPSPassiveOperationV2{{
			Kind:       dpsOpDamage,
			Source:     "spellblade_proc",
			DamageType: "physical",
			Amount:     100,
		}},
	}
}

func kogMawWScenarioPassive() model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:               "skill_kogmaw_w_bio_arcane_barrage",
		SourceCategory:          "skill_passive",
		SourceID:                "skill_kogmaw_w_bio_arcane_barrage",
		SourceType:              "skill",
		TriggerID:               "kogmaw_w_pre_enabled_on_hit",
		TriggerKind:             dpsTriggerOnBasicAttackHit,
		RequiresScenarioStateID: "kogmaw_w_pre_enabled",
		Operations: []model.DPSPassiveOperationV2{{
			Kind:             dpsOpDamage,
			Source:           "kogmaw_w_on_hit",
			DamageType:       "magic",
			TargetMaxHPRatio: 0.03,
		}},
	}
}

func guinsoosWrathPassive() model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:      "item_3124_guinsoos_rageblade_wrath_dps_v2",
		SourceCategory: "item_passive",
		SourceID:       "item_3124_guinsoos_rageblade",
		SourceType:     "item",
		TriggerID:      "guinsoos_wrath_on_hit",
		TriggerKind:    dpsTriggerOnBasicAttackHit,
		Operations: []model.DPSPassiveOperationV2{{
			Kind:       dpsOpDamage,
			Source:     "guinsoos_wrath_on_hit",
			DamageType: "magic",
			Amount:     30,
		}},
	}
}

func bladeOfTheRuinedKingPassive() model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:      "item_3153_blade_of_the_ruined_king_mists_edge_dps_v2",
		SourceCategory: "item_passive",
		SourceID:       "item_3153_blade_of_the_ruined_king",
		SourceType:     "item",
		TriggerID:      "blade_current_hp_on_hit",
		TriggerKind:    dpsTriggerOnBasicAttackHit,
		Operations: []model.DPSPassiveOperationV2{{
			Kind:                 dpsOpDamage,
			Source:               "blade_of_the_ruined_king_current_hp_on_hit",
			DamageType:           "physical",
			TargetCurrentHPRatio: 0.06,
			TargetCurrentHPBasis: "attack_start",
		}},
	}
}

func krakenSlayerPassive() model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:      "item_6672_kraken_slayer_bring_it_down_dps_v2",
		SourceCategory: "item_passive",
		SourceID:       "item_6672_kraken_slayer",
		SourceType:     "item",
		TriggerID:      "kraken_every_3_hit",
		TriggerKind:    dpsTriggerEveryNBasicAttack,
		EveryN:         3,
		Operations: []model.DPSPassiveOperationV2{{
			Kind:                 dpsOpDamage,
			Source:               "kraken_slayer_bring_it_down",
			DamageType:           "physical",
			Amount:               120,
			TargetMissingHPAmp:   0.75,
			TargetMissingHPBasis: "attack_start",
		}},
	}
}

func canonicalAttackSpeedCurve(base model.DPSCurveRunSpecV2, curveID string, attackSpeed float64) model.DPSCurveRunSpecV2 {
	curve := base
	curve.CurveID = curveID
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes = copyDPSFloatMap(base.ResolvedSnapshot.AttackerSnapshot.Attributes)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = attackSpeed
	return curve
}

func canonicalAttackSpeedBuffPassive(stateID string) model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:               "canonical_attack_speed_buff",
		SourceCategory:          "skill_passive",
		SourceID:                "canonical_attack_speed_buff",
		SourceType:              "skill",
		TriggerID:               "canonical_attack_speed_modifier",
		TriggerKind:             dpsTriggerPreEnabledModifier,
		RequiresScenarioStateID: stateID,
		Operations: []model.DPSPassiveOperationV2{{
			Kind:         dpsOpStatModifier,
			Source:       "canonical_attack_speed_buff",
			AttrKey:      "attack_speed",
			ModifierMode: "percent",
			Value:        1,
		}},
	}
}

func canonicalHeroOnHitPassive() model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:      "canonical_hero_on_hit_passive",
		SourceCategory: "skill_passive",
		SourceID:       "canonical_hero_on_hit_passive",
		SourceType:     "skill",
		TriggerID:      "canonical_hero_on_hit",
		TriggerKind:    dpsTriggerOnBasicAttackHit,
		Operations: []model.DPSPassiveOperationV2{{
			Kind:       dpsOpDamage,
			Source:     "canonical_hero_on_hit",
			DamageType: "magic",
			Amount:     10,
		}},
	}
}

func canonicalItemOnHitPassive() model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:      "canonical_item_on_hit_passive",
		SourceCategory: "item_passive",
		SourceID:       "canonical_item_on_hit_passive",
		SourceType:     "item",
		TriggerID:      "canonical_item_on_hit",
		TriggerKind:    dpsTriggerOnBasicAttackHit,
		Operations: []model.DPSPassiveOperationV2{{
			Kind:       dpsOpDamage,
			Source:     "canonical_item_on_hit",
			DamageType: "magic",
			Amount:     20,
		}},
	}
}

func canonicalDotOnlyPassive() model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:      "canonical_dot_apply_passive",
		SourceCategory: "skill_passive",
		SourceID:       "canonical_dot_apply_passive",
		SourceType:     "skill",
		TriggerID:      "canonical_dot_apply",
		TriggerKind:    dpsTriggerOnBasicAttackHit,
		Operations: []model.DPSPassiveOperationV2{{
			Kind:           dpsOpApplyDot,
			Source:         "canonical_dot_tick",
			DamageType:     "magic",
			Amount:         5,
			DurationMs:     4000,
			TickIntervalMs: 1000,
			RefreshMode:    "refresh",
		}},
	}
}

func attackerAttrRatioOnHitPassive(source string, attr string, ratio float64, readKind model.AttributeReadKind) model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:      source,
		EffectID:       source + "_effect",
		SourceCategory: "item_passive",
		SourceID:       source,
		SourceType:     "item",
		TriggerID:      source + "_on_hit",
		TriggerKind:    dpsTriggerOnBasicAttackHit,
		Operations: []model.DPSPassiveOperationV2{{
			Kind:              dpsOpDamage,
			Source:            source,
			DamageType:        "physical",
			AttackerAttr:      attr,
			AttackerAttrRead:  readKind,
			AttackerAttrRatio: ratio,
		}},
	}
}

func canonicalStackingStatModifierPassive(passiveID string, stackKey string, durationMs int64, maxStacks int, attackSpeedPerStack float64, adPerStack float64) model.DPSPassiveEffectV2 {
	operations := []model.DPSPassiveOperationV2{
		{Kind: dpsOpAddStack, Source: passiveID + "_add_stack", StackKey: stackKey, MaxStacks: maxStacks, DurationMs: durationMs, RefreshMode: "refresh"},
		{Kind: dpsOpStatModifier, Source: passiveID + "_attack_speed", StackKey: stackKey, AttrKey: "attack_speed", ModifierMode: "percent", Value: attackSpeedPerStack, PerStack: true},
	}
	if adPerStack != 0 {
		operations = append(operations, model.DPSPassiveOperationV2{
			Kind:         dpsOpStatModifier,
			Source:       passiveID + "_ad",
			StackKey:     stackKey,
			AttrKey:      "ad",
			ModifierMode: "flat",
			Value:        adPerStack,
			PerStack:     true,
		})
	}
	return model.DPSPassiveEffectV2{
		PassiveID:      passiveID,
		EffectID:       passiveID + "_effect",
		SourceCategory: "skill_passive",
		SourceID:       passiveID,
		SourceType:     "skill",
		TriggerID:      passiveID + "_on_hit",
		TriggerKind:    dpsTriggerStackOnHit,
		Operations:     operations,
	}
}

func enableDPSPassivesForTest(curve *model.DPSCurveRunSpecV2, passives ...model.DPSPassiveEffectV2) {
	ids := make([]string, 0, len(passives))
	for _, passive := range passives {
		ids = append(ids, passive.PassiveID)
	}
	curve.Selection.EnabledPassiveEffects = ids
	curve.ResolvedSnapshot.EnabledPassiveEffects = ids
	curve.ResolvedSnapshot.PassiveEffects = passives
}

func enableTargetDPSPassivesForTest(curve *model.DPSCurveRunSpecV2, targetItemID string, passives ...model.DPSPassiveEffectV2) {
	ids := make([]string, 0, len(passives))
	for _, passive := range passives {
		ids = append(ids, passive.PassiveID)
	}
	curve.Selection.TargetEquipmentSet = []string{targetItemID}
	curve.ResolvedSnapshot.TargetEquipmentSet = []string{targetItemID}
	curve.ResolvedSnapshot.TargetEquipmentStats = map[string]float64{}
	curve.Selection.TargetEnabledPassiveEffects = ids
	curve.ResolvedSnapshot.TargetEnabledPassiveEffects = ids
	curve.ResolvedSnapshot.PassiveEffects = passives
}

func enableMixedDPSPassivesForTest(
	curve *model.DPSCurveRunSpecV2,
	targetItemID string,
	attackerPassives []model.DPSPassiveEffectV2,
	targetPassives []model.DPSPassiveEffectV2,
) {
	attackerIDs := make([]string, 0, len(attackerPassives))
	for _, passive := range attackerPassives {
		attackerIDs = append(attackerIDs, passive.PassiveID)
	}
	targetIDs := make([]string, 0, len(targetPassives))
	for _, passive := range targetPassives {
		targetIDs = append(targetIDs, passive.PassiveID)
	}
	allPassives := make([]model.DPSPassiveEffectV2, 0, len(attackerPassives)+len(targetPassives))
	allPassives = append(allPassives, attackerPassives...)
	allPassives = append(allPassives, targetPassives...)

	curve.Selection.EnabledPassiveEffects = attackerIDs
	curve.ResolvedSnapshot.EnabledPassiveEffects = attackerIDs
	curve.Selection.TargetEquipmentSet = []string{targetItemID}
	curve.ResolvedSnapshot.TargetEquipmentSet = []string{targetItemID}
	curve.ResolvedSnapshot.TargetEquipmentStats = map[string]float64{}
	curve.Selection.TargetEnabledPassiveEffects = targetIDs
	curve.ResolvedSnapshot.TargetEnabledPassiveEffects = targetIDs
	curve.ResolvedSnapshot.PassiveEffects = allPassives
}

func attackTimes(result model.DPSCurveResultV2) []int64 {
	times := make([]int64, 0, len(result.AttackTimeline))
	for _, event := range result.AttackTimeline {
		times = append(times, event.TimeMs)
	}
	return times
}

func damageTimesBySource(result model.DPSCurveResultV2, source string) []int64 {
	times := make([]int64, 0)
	for _, event := range result.DamageTimeline {
		if event.Source == source {
			times = append(times, event.TimeMs)
		}
	}
	return times
}

func damageSources(result model.DPSCurveResultV2) []string {
	sources := make([]string, 0, len(result.DamageTimeline))
	for _, event := range result.DamageTimeline {
		sources = append(sources, event.Source)
	}
	return sources
}

func rawDamagesBySource(result model.DPSCurveResultV2, source string) []float64 {
	values := make([]float64, 0)
	for _, event := range result.DamageTimeline {
		if event.Source == source {
			values = append(values, event.RawDamage)
		}
	}
	return values
}

func rawAttackSpeeds(result model.DPSCurveResultV2) []float64 {
	values := make([]float64, 0, len(result.AttackIntervalTimeline))
	for _, event := range result.AttackIntervalTimeline {
		values = append(values, event.RawAttackSpeed)
	}
	return values
}

func effectBreakdownKindsAndSources(result model.DPSCurveResultV2) []string {
	values := make([]string, 0, len(result.EffectBreakdown))
	for _, event := range result.EffectBreakdown {
		values = append(values, event.Kind+":"+event.Source)
	}
	return values
}

func hasEffectBreakdown(result model.DPSCurveResultV2, kind string, source string, amount float64) bool {
	for _, event := range result.EffectBreakdown {
		if event.Kind == kind && event.Source == source && almostEqual(event.Amount, amount) {
			return true
		}
	}
	return false
}

func sameInt64s(left []int64, right []int64) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func sameFloat64s(left []float64, right []float64) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if !almostEqual(left[i], right[i]) {
			return false
		}
	}
	return true
}

func sameStrings(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func damageCountBySource(result model.DPSCurveResultV2, source string) int {
	count := 0
	for _, event := range result.DamageTimeline {
		if event.Source == source {
			count++
		}
	}
	return count
}

func lastTargetHPAfterTime(result model.DPSCurveResultV2, timeMs int64) float64 {
	hp := math.NaN()
	for _, event := range result.DamageTimeline {
		if event.TimeMs == timeMs {
			hp = event.TargetHPAfter
		}
	}
	return hp
}

func hasBreakdown(result model.DPSCurveResultV2, kind string, amount float64) bool {
	for _, event := range result.EffectBreakdown {
		if event.Kind == kind && almostEqual(event.Amount, amount) {
			return true
		}
	}
	return false
}

func maxBreakdownAmount(result model.DPSCurveResultV2, kind string) float64 {
	maxAmount := 0.0
	for _, event := range result.EffectBreakdown {
		if event.Kind == kind && event.Amount > maxAmount {
			maxAmount = event.Amount
		}
	}
	return maxAmount
}

func effectBreakdownMessageContains(result model.DPSCurveResultV2, kind string, needle string) bool {
	for _, event := range result.EffectBreakdown {
		if event.Kind == kind && strings.Contains(event.Message, needle) {
			return true
		}
	}
	return false
}

func effectBreakdownResolvedMultiplierAlmostEqual(result model.DPSCurveResultV2, kind string, want float64) bool {
	const prefix = "resolvedMultiplier="
	for _, event := range result.EffectBreakdown {
		if event.Kind != kind {
			continue
		}
		index := strings.Index(event.Message, prefix)
		if index < 0 {
			continue
		}
		valueText := event.Message[index+len(prefix):]
		if comma := strings.IndexByte(valueText, ' '); comma >= 0 {
			valueText = valueText[:comma]
		}
		value, err := strconv.ParseFloat(valueText, 64)
		if err != nil {
			continue
		}
		return almostEqual(value, want)
	}
	return false
}

func effectBreakdownAmountBySource(result model.DPSCurveResultV2, kind string, source string) float64 {
	for _, event := range result.EffectBreakdown {
		if event.Kind == kind && event.Source == source {
			return event.Amount
		}
	}
	return 0
}

func findCoefficientBucketEffectBreakdown(result model.DPSCurveResultV2, messageNeedle string) *model.DPSEffectBreakdownV2 {
	for i := range result.EffectBreakdown {
		event := &result.EffectBreakdown[i]
		if event.Kind == dpsEffectCoefficientBucket &&
			strings.Contains(event.Message, messageNeedle) &&
			event.CoefficientBucket != nil {
			return event
		}
	}
	return nil
}

func mustJSONForDPSTest(t *testing.T, value any) []byte {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func lastDPSOutput(t *testing.T, outbox []byte) model.SingleAttackerDPSOutputV2 {
	t.Helper()
	var output model.SingleAttackerDPSOutputV2
	offset := 0
	for offset+abi.HeaderLen <= len(outbox) {
		frame, err := abi.DecodeFrame(outbox[offset:])
		if err != nil {
			t.Fatal(err)
		}
		if frame.Kind == model.FrameKindDone {
			if err := json.Unmarshal(frame.Payload, &output); err != nil {
				t.Fatal(err)
			}
		}
		offset += abi.HeaderLen + len(frame.Payload)
	}
	return output
}

func testOnHitCooldownPassive(internalCooldownMs int64) model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:          "test_on_hit_cooldown",
		SourceCategory:     "item_passive",
		SourceID:           "test_on_hit_cooldown_item",
		SourceType:         "item",
		TriggerID:          "test_on_hit_cooldown_trigger",
		TriggerKind:        dpsTriggerOnBasicAttackHit,
		InternalCooldownMs: internalCooldownMs,
		Operations: []model.DPSPassiveOperationV2{{
			Kind:       dpsOpDamage,
			Source:     "test_on_hit_cooldown_proc",
			DamageType: "magic",
			Amount:     10,
		}},
	}
}

func passiveCooldownEvidenceCount(result model.DPSCurveResultV2, triggered bool, skipped bool) int {
	count := 0
	for _, event := range result.EffectBreakdown {
		if event.Kind != dpsEffectPassiveCooldown || event.PassiveCooldown == nil {
			continue
		}
		if triggered && event.PassiveCooldown.Triggered {
			count++
		}
		if skipped && event.PassiveCooldown.Skipped {
			count++
		}
	}
	return count
}

func passiveCooldownEvidenceAt(result model.DPSCurveResultV2, timeMs int64) *model.DPSEffectBreakdownV2 {
	for i := range result.EffectBreakdown {
		event := &result.EffectBreakdown[i]
		if event.Kind == dpsEffectPassiveCooldown && event.TimeMs == timeMs {
			return event
		}
	}
	return nil
}

func TestSingleAttackerDPSPassiveInternalCooldownSkipsUntilReady(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1001
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, testOnHitCooldownPassive(1000))
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 2
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if result.AttackCount != 3 {
		t.Fatalf("attackCount = %d, want 3 attacks despite cooldown skip", result.AttackCount)
	}
	if got := damageCountBySourceAt(result, "test_on_hit_cooldown_proc", 0); got != 1 {
		t.Fatalf("proc at 0ms = %d, want 1", got)
	}
	if got := damageCountBySourceAt(result, "test_on_hit_cooldown_proc", 500); got != 0 {
		t.Fatalf("proc at 500ms = %d, want cooldown skip", got)
	}
	if got := damageCountBySourceAt(result, "test_on_hit_cooldown_proc", 1000); got != 1 {
		t.Fatalf("proc at 1000ms = %d, want 1 after cooldown", got)
	}
	if got := result.DamageBySource["test_on_hit_cooldown_proc"]; !almostEqual(got, 20) {
		t.Fatalf("damageBySource proc = %.4f, want 20 from two triggers only", got)
	}
	if got := passiveCooldownEvidenceCount(result, true, false); got != 2 {
		t.Fatalf("triggered passive_cooldown evidence = %d, want 2", got)
	}
	if got := passiveCooldownEvidenceCount(result, false, true); got != 1 {
		t.Fatalf("skipped passive_cooldown evidence = %d, want 1 at 500ms", got)
	}
	if skipped := passiveCooldownEvidenceAt(result, 500); skipped == nil || !skipped.PassiveCooldown.Skipped {
		t.Fatalf("skipped evidence at 500ms = %+v, want skipped=true", skipped)
	}
}

func TestSingleAttackerDPSPassiveInternalCooldownDoesNotBlockBaseAttack(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 501
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, testOnHitCooldownPassive(1000))
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 2
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if result.AttackCount != 2 {
		t.Fatalf("attackCount = %d, want 2", result.AttackCount)
	}
	if got := damageCountBySourceAt(result, "test_on_hit_cooldown_proc", 500); got != 0 {
		t.Fatalf("passive proc at 500ms = %d, want cooldown skip", got)
	}
	basicAttackDamage := 0.0
	for _, event := range result.DamageTimeline {
		if event.TimeMs == 500 && !event.PhantomHit {
			basicAttackDamage += event.FinalDamage
		}
	}
	if !almostEqual(basicAttackDamage, 100) {
		t.Fatalf("basic attack damage at 500ms = %.4f, want 100 despite passive cooldown", basicAttackDamage)
	}
}

func TestSingleAttackerDPSEveryNPassiveCooldownOrder(t *testing.T) {
	passive := vayneSilverBoltsPassive()
	passive.InternalCooldownMs = 1000
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 2501
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, passive)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 0
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.SkillPassiveTriggers) != 1 || result.SkillPassiveTriggers[0].TimeMs != 2000 {
		t.Fatalf("skillPassiveTriggers = %+v, want every-N proc on third hit at 2000ms", result.SkillPassiveTriggers)
	}
	if got := passiveCooldownEvidenceCount(result, true, false); got != 1 {
		t.Fatalf("triggered passive_cooldown evidence = %d, want one proc at third hit", got)
	}
}

func TestSingleAttackerDPSIncomingModifierInternalCooldown(t *testing.T) {
	passive := syntheticIncomingDamageModifierPassive()
	passive.InternalCooldownMs = 1000
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 501
	curve := &input.Curves[0]
	enableTargetDPSPassivesForTest(curve, "target_item_slot", passive)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 2
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.DamageTimeline) < 2 {
		t.Fatalf("damageTimeline = %+v, want at least two basic attacks", result.DamageTimeline)
	}
	firstHit := result.DamageTimeline[0]
	secondHit := result.DamageTimeline[1]
	if !almostEqual(firstHit.FinalDamage, 80) {
		t.Fatalf("first hit finalDamage = %.4f, want 80 with incoming modifier", firstHit.FinalDamage)
	}
	if !almostEqual(secondHit.FinalDamage, 100) {
		t.Fatalf("second hit finalDamage = %.4f, want 100 without modifier during cooldown", secondHit.FinalDamage)
	}
	if len(result.ItemPassiveTriggers) != 1 {
		t.Fatalf("itemPassiveTriggers = %v, want one modifier trigger", result.ItemPassiveTriggers)
	}
	if got := passiveCooldownEvidenceCount(result, true, false); got != 1 {
		t.Fatalf("triggered passive_cooldown evidence = %d, want 1", got)
	}
	if got := passiveCooldownEvidenceCount(result, false, true); got != 1 {
		t.Fatalf("skipped passive_cooldown evidence = %d, want 1 on second hit", got)
	}
}

func TestSingleAttackerDPSHPChangeBucketInternalCooldown(t *testing.T) {
	passive := syntheticHPChangeIncomingPhysicalBucketPassive(-0.2)
	passive.InternalCooldownMs = 1000
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 501
	curve := &input.Curves[0]
	enableTargetDPSPassivesForTest(curve, "item_hp_change_incoming_physical", passive)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 2
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.DamageTimeline) < 2 {
		t.Fatalf("damageTimeline = %+v, want at least two basic attacks", result.DamageTimeline)
	}
	firstHit := result.DamageTimeline[0]
	secondHit := result.DamageTimeline[1]
	if !almostEqual(firstHit.FinalDamage, 80) {
		t.Fatalf("first hit finalDamage = %.4f, want 80 with bucket modifier", firstHit.FinalDamage)
	}
	if !almostEqual(secondHit.FinalDamage, 100) {
		t.Fatalf("second hit finalDamage = %.4f, want 100 without modifier during cooldown", secondHit.FinalDamage)
	}
	if len(result.ItemPassiveTriggers) != 1 {
		t.Fatalf("itemPassiveTriggers = %v, want one modifier trigger", result.ItemPassiveTriggers)
	}
	if got := passiveCooldownEvidenceCount(result, true, false); got != 1 {
		t.Fatalf("triggered passive_cooldown evidence = %d, want 1", got)
	}
	if got := passiveCooldownEvidenceCount(result, false, true); got != 1 {
		t.Fatalf("skipped passive_cooldown evidence = %d, want 1 on second hit", got)
	}
	bucketEvidence := findCoefficientBucketEffectBreakdown(result, "bucketKey=incoming_physical_reduction aggregationMode=add valueUnit=percent_delta raw=100 result=100")
	if bucketEvidence == nil || bucketEvidence.CoefficientBucket == nil {
		t.Fatalf("effectBreakdown = %+v, want skipped coefficient_bucket evidence on cooldown hit", result.EffectBreakdown)
	}
	foundCooldownSkip := false
	for _, candidate := range bucketEvidence.CoefficientBucket.Skipped {
		if !candidate.Applied && candidate.SkipReason == "passive_cooldown" {
			foundCooldownSkip = true
			break
		}
	}
	if !foundCooldownSkip {
		t.Fatalf("coefficientBucket.skipped = %+v, want skipped reason passive_cooldown", bucketEvidence.CoefficientBucket.Skipped)
	}
}

func TestSingleAttackerDPSIncomingModifierMultiOpSharesCooldownGate(t *testing.T) {
	passive := syntheticIncomingDamageModifierPassive()
	passive.InternalCooldownMs = 1000
	passive.Operations = append(passive.Operations, model.DPSPassiveOperationV2{
		Kind:         dpsOpDamageModifier,
		Source:       "randuins_incoming_reduction_second",
		TargetRole:   "target",
		ModifierMode: "percent",
		Value:        -0.1,
		ValuePhase:   "incoming",
	})
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	enableTargetDPSPassivesForTest(curve, "target_item_slot", passive)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.DamageTimeline) != 1 {
		t.Fatalf("damageTimeline = %+v, want one basic attack", result.DamageTimeline)
	}
	if !almostEqual(result.DamageTimeline[0].FinalDamage, 72) {
		t.Fatalf("finalDamage = %.4f, want 72 from both modifiers in one event", result.DamageTimeline[0].FinalDamage)
	}
	if got := passiveCooldownEvidenceCount(result, true, false); got != 1 {
		t.Fatalf("triggered passive_cooldown evidence = %d, want 1 shared gate for both operations", got)
	}
	if len(result.ItemPassiveTriggers) != 1 {
		t.Fatalf("itemPassiveTriggers = %v, want one shared passive trigger", result.ItemPassiveTriggers)
	}
}

func physicalBasicAttackFinalDamageAt(result model.DPSCurveResultV2, timeMs int64) float64 {
	for _, event := range result.DamageTimeline {
		if event.TimeMs == timeMs && event.DamageType == "physical" && !event.PhantomHit {
			return event.FinalDamage
		}
	}
	return 0
}

func mixedCooldownCritContextAndDamagePassive(internalCooldownMs int64) model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:          "test_crit_damage_shared_gate",
		SourceCategory:     "item_passive",
		SourceID:           "test_crit_damage_item",
		SourceType:         "item",
		TriggerID:          "test_crit_damage_trigger",
		TriggerKind:        dpsTriggerOnBasicAttackHit,
		InternalCooldownMs: internalCooldownMs,
		Operations: []model.DPSPassiveOperationV2{
			{
				Kind:                      dpsOpCritContextModifier,
				Source:                    "test_crit_mod",
				ForceCrit:                 true,
				HasCritMultiplierOverride: true,
				CritMultiplierOverride:    2,
			},
			{
				Kind:       dpsOpDamage,
				Source:     "test_crit_damage_proc",
				DamageType: "magic",
				Amount:     10,
			},
		},
	}
}

func mixedCooldownIncomingModifierAndDamagePassive(internalCooldownMs int64) model.DPSPassiveEffectV2 {
	passive := syntheticIncomingDamageModifierPassive()
	passive.InternalCooldownMs = internalCooldownMs
	passive.Operations = append(passive.Operations, model.DPSPassiveOperationV2{
		Kind:       dpsOpDamage,
		Source:     "randuins_bonus_damage",
		DamageType: "magic",
		Amount:     15,
	})
	return passive
}

func mixedCooldownHPBucketAndDamagePassive(internalCooldownMs int64) model.DPSPassiveEffectV2 {
	passive := syntheticHPChangeIncomingPhysicalBucketPassive(-0.2)
	passive.InternalCooldownMs = internalCooldownMs
	passive.Operations = append(passive.Operations, model.DPSPassiveOperationV2{
		Kind:       dpsOpDamage,
		Source:     "hp_bucket_bonus_damage",
		DamageType: "magic",
		Amount:     12,
	})
	return passive
}

func mixedCooldownNextAttackPassive(stateID string, internalCooldownMs int64) model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:               "item_next_attack_mixed_cooldown_test",
		SourceCategory:          "item_passive",
		SourceID:                "item_next_attack_mixed_cooldown",
		SourceType:              "item",
		TriggerID:               "next_attack_mixed_cooldown",
		TriggerKind:             dpsTriggerNextBasicAttackAfterState,
		RequiresScenarioStateID: stateID,
		InternalCooldownMs:      internalCooldownMs,
		Operations: []model.DPSPassiveOperationV2{
			{
				Kind:                      dpsOpCritContextModifier,
				Source:                    "next_attack_mixed_crit",
				ForceCrit:                 true,
				HasCritMultiplierOverride: true,
				CritMultiplierOverride:    2,
			},
			{
				Kind:       dpsOpDamage,
				Source:     "next_attack_mixed_proc",
				DamageType: "physical",
				Amount:     50,
			},
		},
	}
}

func mixedCooldownPhantomPassive(internalCooldownMs int64) model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:          "test_phantom_shared_gate",
		SourceCategory:     "item_passive",
		SourceID:           "test_phantom_shared_gate_item",
		SourceType:         "item",
		TriggerID:          "test_phantom_shared_gate_trigger",
		TriggerKind:        dpsTriggerOnBasicAttackHit,
		InternalCooldownMs: internalCooldownMs,
		Operations: []model.DPSPassiveOperationV2{
			{Kind: dpsOpAddStack, Source: "test_phantom_gate_stack", StackKey: "test_phantom_gate_stack", MaxStacks: 4, RefreshMode: "refresh"},
			{Kind: dpsOpDamage, Source: "test_phantom_gate_copyable", DamageType: "magic", Amount: 20, PhantomHitCopyable: true},
			{
				Kind:          dpsOpPhantomHitOnHitRepeat,
				Source:        "test_phantom_gate_repeat",
				StackKey:      "test_phantom_gate_stack",
				TriggerStacks: 1,
				RepeatCount:   1,
				RepeatTag:     "phantom_gate",
				RepeatScope:   dpsRepeatScopeCopyableOnHit,
			},
		},
	}
}

func TestSingleAttackerDPSPassiveCooldownSharesGateAcrossCritContextAndDamage(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 501
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, mixedCooldownCritContextAndDamagePassive(1000))
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 2
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if result.AttackCount != 2 {
		t.Fatalf("attackCount = %d, want 2 basic attacks despite cooldown skip", result.AttackCount)
	}
	if got := damageCountBySourceAt(result, "test_crit_damage_proc", 0); got != 1 {
		t.Fatalf("proc at 0ms = %d, want crit modifier and damage op both firing once", got)
	}
	if got := damageCountBySourceAt(result, "test_crit_damage_proc", 500); got != 0 {
		t.Fatalf("proc at 500ms = %d, want cooldown skip", got)
	}
	if !effectBreakdownMessageContains(result, dpsOpCritContextModifier, "forceCrit=true") {
		t.Fatalf("effectBreakdown = %+v, want crit modifier evidence on first hit", result.EffectBreakdown)
	}
	if len(result.ItemPassiveTriggers) != 1 {
		t.Fatalf("itemPassiveTriggers = %v, want one shared passive trigger", result.ItemPassiveTriggers)
	}
	if got := passiveCooldownEvidenceCount(result, true, false); got != 1 {
		t.Fatalf("triggered passive_cooldown evidence = %d, want 1", got)
	}
	if got := passiveCooldownEvidenceCount(result, false, true); got != 1 {
		t.Fatalf("skipped passive_cooldown evidence = %d, want 1 at 500ms", got)
	}
	if got := result.DamageBySource["test_crit_damage_proc"]; !almostEqual(got, 10) {
		t.Fatalf("damageBySource proc = %.4f, want 10 from first hit only", got)
	}
}

func TestSingleAttackerDPSPassiveCooldownSharesGateAcrossIncomingModifierAndDamage(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 501
	curve := &input.Curves[0]
	enableTargetDPSPassivesForTest(curve, "target_item_slot", mixedCooldownIncomingModifierAndDamagePassive(1000))
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 2
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.DamageTimeline) < 2 {
		t.Fatalf("damageTimeline = %+v, want at least two basic attacks", result.DamageTimeline)
	}
	if !almostEqual(physicalBasicAttackFinalDamageAt(result, 0), 80) {
		t.Fatalf("first hit basic attack = %.4f, want 80 with incoming modifier", physicalBasicAttackFinalDamageAt(result, 0))
	}
	if !almostEqual(physicalBasicAttackFinalDamageAt(result, 500), 100) {
		t.Fatalf("second hit basic attack = %.4f, want 100 without modifier during cooldown", physicalBasicAttackFinalDamageAt(result, 500))
	}
	if got := damageCountBySourceAt(result, "randuins_bonus_damage", 0); got != 1 {
		t.Fatalf("bonus damage at 0ms = %d, want incoming modifier and damage op both firing", got)
	}
	if got := damageCountBySourceAt(result, "randuins_bonus_damage", 500); got != 0 {
		t.Fatalf("bonus damage at 500ms = %d, want cooldown skip", got)
	}
	if len(result.ItemPassiveTriggers) != 1 {
		t.Fatalf("itemPassiveTriggers = %v, want one shared passive trigger", result.ItemPassiveTriggers)
	}
	if got := passiveCooldownEvidenceCount(result, true, false); got != 1 {
		t.Fatalf("triggered passive_cooldown evidence = %d, want 1", got)
	}
	if got := passiveCooldownEvidenceCount(result, false, true); got != 1 {
		t.Fatalf("skipped passive_cooldown evidence = %d, want 1 at 500ms", got)
	}
}

func TestSingleAttackerDPSPassiveCooldownSharesGateAcrossHPBucketAndDamage(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 501
	curve := &input.Curves[0]
	enableTargetDPSPassivesForTest(curve, "item_hp_change_incoming_physical", mixedCooldownHPBucketAndDamagePassive(1000))
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 2
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if !almostEqual(physicalBasicAttackFinalDamageAt(result, 0), 80) {
		t.Fatalf("first hit basic attack = %.4f, want 80 with hp_change bucket", physicalBasicAttackFinalDamageAt(result, 0))
	}
	if !almostEqual(physicalBasicAttackFinalDamageAt(result, 500), 100) {
		t.Fatalf("second hit basic attack = %.4f, want 100 without bucket during cooldown", physicalBasicAttackFinalDamageAt(result, 500))
	}
	if got := damageCountBySourceAt(result, "hp_bucket_bonus_damage", 0); got != 1 {
		t.Fatalf("bonus damage at 0ms = %d, want bucket and damage op both firing", got)
	}
	if got := damageCountBySourceAt(result, "hp_bucket_bonus_damage", 500); got != 0 {
		t.Fatalf("bonus damage at 500ms = %d, want cooldown skip", got)
	}
	if len(result.ItemPassiveTriggers) != 1 {
		t.Fatalf("itemPassiveTriggers = %v, want one shared passive trigger", result.ItemPassiveTriggers)
	}
	if got := passiveCooldownEvidenceCount(result, true, false); got != 1 {
		t.Fatalf("triggered passive_cooldown evidence = %d, want 1", got)
	}
	if got := passiveCooldownEvidenceCount(result, false, true); got != 1 {
		t.Fatalf("skipped passive_cooldown evidence = %d, want 1 at 500ms", got)
	}
}

func TestSingleAttackerDPSNextAttackStateCooldownMixedPreDamageConsumesOnlyOnTriggered(t *testing.T) {
	stateID := "next_attack_mixed_cooldown_ready"
	scenario := spellbladeScenarioState(stateID, 0, 8000)
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1501
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, mixedCooldownNextAttackPassive(stateID, 1000))
	curve.Selection.ScenarioStates = []model.DPSScenarioStateV2{scenario}
	curve.ResolvedSnapshot.ScenarioStates = []model.DPSScenarioStateV2{scenario}
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 2
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if got := damageCountBySource(result, "next_attack_mixed_proc"); got != 1 {
		t.Fatalf("next_attack proc count = %d, want one trigger on first hit only", got)
	}
	if got := damageCountBySourceAt(result, "next_attack_mixed_proc", 500); got != 0 {
		t.Fatalf("proc at 500ms = %d, want cooldown skip without extra state consume", got)
	}
	if got := energizedBreakdownCount(result, dpsEffectNextAttackStateConsume); got != 1 {
		t.Fatalf("next_attack_state_consume evidence = %d, want exactly one consume on triggered hit", got)
	}
	if !effectBreakdownMessageContains(result, dpsEffectNextAttackStateConsume, "consumedScenarioStateId="+stateID) {
		t.Fatalf("effectBreakdown = %+v, want consume evidence for %s", result.EffectBreakdown, stateID)
	}
	if got := passiveCooldownEvidenceCount(result, true, false); got != 1 {
		t.Fatalf("triggered passive_cooldown evidence = %d, want 1", got)
	}
}

func TestSingleAttackerDPSPhantomCooldownSharesGateWithRealHit(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 501
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, mixedCooldownPhantomPassive(1000))
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 2
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if got := damageCountBySourceAt(result, "test_phantom_gate_copyable", 0); got != 2 {
		t.Fatalf("copyable damage at 0ms = %d, want real hit + phantom on same event", got)
	}
	if got := phantomDamageCountBySourceAt(result, "test_phantom_gate_copyable", 0); got != 1 {
		t.Fatalf("phantom copyable damage at 0ms = %d, want 1", got)
	}
	if got := damageCountBySourceAt(result, "test_phantom_gate_copyable", 500); got != 0 {
		t.Fatalf("copyable damage at 500ms = %d, want cooldown skip for future attack", got)
	}
	if got := passiveCooldownEvidenceCount(result, true, false); got != 1 {
		t.Fatalf("triggered passive_cooldown evidence = %d, want 1", got)
	}
	if got := passiveCooldownEvidenceCount(result, false, true); got != 1 {
		t.Fatalf("skipped passive_cooldown evidence = %d, want 1 at 500ms", got)
	}
}

func TestSingleAttackerDPSEnergizedInternalCooldownDoesNotConsumeWhenSkipped(t *testing.T) {
	passive := testEnergizedPassive()
	passive.InternalCooldownMs = 5000
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 3501
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, passive)
	configureEnergizedCurve(curve, 3501, 1)
	curve.ResolvedSnapshot.ScenarioStates = []model.DPSScenarioStateV2{
		energizedScenarioCharge("test_energized_charge", 3),
	}

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if got := damageCountBySourceAt(result, "test_energized_proc", 0); got != 1 {
		t.Fatalf("proc at 0ms = %d, want initial ready proc", got)
	}
	if got := damageCountBySourceAt(result, "test_energized_proc", 3000); got != 0 {
		t.Fatalf("proc at 3000ms = %d, want cooldown skip", got)
	}
	check := energizedBreakdownAt(result, dpsEffectEnergizedChargeCheck, 3000)
	if check == nil || strings.Contains(check.Message, "consumed=true") || strings.Contains(check.Message, "triggered=true") {
		t.Fatalf("check at 3000ms = %+v, want no consume/trigger during cooldown", check)
	}
	if got := passiveCooldownEvidenceCount(result, false, true); got < 1 {
		t.Fatalf("skipped passive_cooldown evidence = %d, want at least one", got)
	}
}

func TestSingleAttackerDPSRejectsNegativeInternalCooldownMs(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	curve := &input.Curves[0]
	passive := testOnHitCooldownPassive(-1)
	enableDPSPassivesForTest(curve, passive)

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "blocked" {
		t.Fatalf("status = %s, want blocked", result.Status)
	}
	found := false
	for _, reason := range result.BlockedReasons {
		if strings.Contains(reason, "test_on_hit_cooldown") && strings.Contains(reason, "internalCooldownMs=-1") {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("blockedReasons = %v, want passive id and negative internalCooldownMs", result.BlockedReasons)
	}
}

func testEnergizedPassive() model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:                "test_energized_passive",
		SourceCategory:           "item_passive",
		SourceID:                 "test_energized_item",
		SourceType:               "item",
		TriggerID:                "test_energized_on_charge",
		TriggerKind:              dpsTriggerEnergizedChargeAndConsume,
		ChargeKey:                "test_energized_charge",
		ChargeGainPerBasicAttack: 1,
		ChargeThreshold:          3,
		ChargeCap:                3,
		ChargeReadyPolicy:        dpsChargeReadyPolicyNextBasicAttackAfterThreshold,
		ConsumeChargeOnTrigger:   true,
		ProcScope:                dpsProcScopeRealBasicAttackOnly,
		Operations: []model.DPSPassiveOperationV2{{
			Kind:       dpsOpDamage,
			Source:     "test_energized_proc",
			DamageType: "magic",
			Amount:     50,
		}},
	}
}

func energizedScenarioCharge(stateID string, stacks int) model.DPSScenarioStateV2 {
	return model.DPSScenarioStateV2{
		StateID:     stateID,
		SourceType:  "item_passive",
		SourceID:    "test_energized_item",
		Activation:  "assumed_charge_before_start",
		Stacks:      stacks,
		StartTimeMs: 0,
	}
}

func configureEnergizedCurve(curve *model.DPSCurveRunSpecV2, durationMs int64, attackSpeed float64) {
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = attackSpeed
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0
}

func energizedBreakdownCount(result model.DPSCurveResultV2, kind string) int {
	count := 0
	for _, event := range result.EffectBreakdown {
		if event.Kind == kind {
			count++
		}
	}
	return count
}

func energizedBreakdownAt(result model.DPSCurveResultV2, kind string, timeMs int64) *model.DPSEffectBreakdownV2 {
	for i := range result.EffectBreakdown {
		event := &result.EffectBreakdown[i]
		if event.Kind == kind && event.TimeMs == timeMs {
			return event
		}
	}
	return nil
}

func energizedGainAt(result model.DPSCurveResultV2, timeMs int64) *model.DPSEffectBreakdownV2 {
	return energizedBreakdownAt(result, dpsEffectEnergizedChargeGain, timeMs)
}

func TestSingleAttackerDPSEnergizedChargesAfterRealBasicAttack(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 2500
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, testEnergizedPassive())
	configureEnergizedCurve(curve, 2500, 1)

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if result.AttackCount != 3 {
		t.Fatalf("attackCount = %d, want 3", result.AttackCount)
	}
	if got := damageCountBySource(result, "test_energized_proc"); got != 0 {
		t.Fatalf("energized proc count = %d, want 0 before ready hit", got)
	}
	if gain := energizedGainAt(result, 0); gain == nil || !almostEqual(gain.Amount, 1) {
		t.Fatalf("first gain = %+v, want postCharge amount 1", gain)
	}
	if gain := energizedGainAt(result, 2000); gain == nil || !strings.Contains(gain.Message, "readyAfterHit=true") || strings.Contains(gain.Message, "triggered=true") {
		t.Fatalf("third hit gain = %+v, want readyAfterHit=true without trigger on threshold hit", gain)
	}
	if got := energizedBreakdownCount(result, dpsEffectEnergizedChargeGain); got != 3 {
		t.Fatalf("gain breakdown count = %d, want one per real basic attack", got)
	}
}

func TestSingleAttackerDPSEnergizedThresholdDoesNotProcSameHit(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 2500
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, testEnergizedPassive())
	configureEnergizedCurve(curve, 2500, 1)

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s, want ok", result.Status)
	}
	thresholdHitMs := int64(2000)
	if got := damageCountBySourceAt(result, "test_energized_proc", thresholdHitMs); got != 0 {
		t.Fatalf("proc count at threshold hit %dms = %d, want same-hit no proc", thresholdHitMs, got)
	}
	check := energizedBreakdownAt(result, dpsEffectEnergizedChargeCheck, thresholdHitMs)
	if check == nil || strings.Contains(check.Message, "triggered=true") {
		t.Fatalf("threshold hit check = %+v, want triggered=false on same hit", check)
	}
}

func TestSingleAttackerDPSEnergizedReadyConsumesOnNextHit(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 3500
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, testEnergizedPassive())
	configureEnergizedCurve(curve, 3500, 1)

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s, want ok", result.Status)
	}
	procHitMs := int64(3000)
	if got := damageCountBySourceAt(result, "test_energized_proc", procHitMs); got != 1 {
		t.Fatalf("proc count at %dms = %d, want ready proc on next hit after threshold", procHitMs, got)
	}
	if len(result.ItemPassiveTriggers) != 1 || result.ItemPassiveTriggers[0].TimeMs != procHitMs {
		t.Fatalf("itemPassiveTriggers = %+v, want one proc at %dms", result.ItemPassiveTriggers, procHitMs)
	}
	if !effectBreakdownMessageContains(result, dpsEffectEnergizedChargeConsume, "consumed=true") {
		t.Fatalf("effectBreakdown = %+v, want consume evidence on proc hit", result.EffectBreakdown)
	}
}

func TestSingleAttackerDPSEnergizedConsumeStartsNextCycle(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 7000
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, testEnergizedPassive())
	configureEnergizedCurve(curve, 7000, 1)

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s, want ok", result.Status)
	}
	if got := damageTimesBySource(result, "test_energized_proc"); !sameInt64s(got, []int64{3000, 6000}) {
		t.Fatalf("proc times = %v, want consume to restart cycle for second proc at 6000ms", got)
	}
	if gain := energizedGainAt(result, 3000); gain == nil || !almostEqual(gain.Amount, 1) {
		t.Fatalf("post-proc gain at 3000ms = %+v, want charge reset then gain to 1", gain)
	}
}

func TestSingleAttackerDPSEnergizedInitialChargeScenarioTriggersFirstHit(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1500
	chargeKey := "test_energized_charge"
	scenario := energizedScenarioCharge(chargeKey, 3)
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, testEnergizedPassive())
	curve.Selection.ScenarioStates = []model.DPSScenarioStateV2{scenario}
	curve.ResolvedSnapshot.ScenarioStates = []model.DPSScenarioStateV2{scenario}
	configureEnergizedCurve(curve, 1500, 1)

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s, want ok", result.Status)
	}
	if got := damageCountBySourceAt(result, "test_energized_proc", 0); got != 1 {
		t.Fatalf("first hit proc count = %d, want initial charged scenario to proc immediately", got)
	}
	check := energizedBreakdownAt(result, dpsEffectEnergizedChargeCheck, 0)
	if check == nil || !strings.Contains(check.Message, "readyBeforeHit=true") || !strings.Contains(check.Message, "triggered=true") {
		t.Fatalf("first hit check = %+v, want ready charged proc evidence", check)
	}
}

func TestSingleAttackerDPSEnergizedTriggeredHitCanReadyNextCycle(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1500
	chargeKey := "test_energized_charge"
	scenario := energizedScenarioCharge(chargeKey, 3)
	passive := testEnergizedPassive()
	passive.ChargeGainPerBasicAttack = 3
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, passive)
	curve.Selection.ScenarioStates = []model.DPSScenarioStateV2{scenario}
	curve.ResolvedSnapshot.ScenarioStates = []model.DPSScenarioStateV2{scenario}
	configureEnergizedCurve(curve, 1500, 1)

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s, want ok", result.Status)
	}
	if got := damageTimesBySource(result, "test_energized_proc"); !sameInt64s(got, []int64{0, 1000}) {
		t.Fatalf("proc times = %v, want first proc and next-cycle proc", got)
	}
	if gain := energizedGainAt(result, 0); gain == nil || !strings.Contains(gain.Message, "readyAfterHit=true") {
		t.Fatalf("post-proc gain = %+v, want same real hit to ready next cycle after gain", gain)
	}
}

func TestSingleAttackerDPSEnergizedDoesNotChargeFromPhantomHit(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 2000
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, testEnergizedPassive(), testPhantomHitPassive())
	configureEnergizedCurve(curve, 2000, 2)

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s, want ok", result.Status)
	}
	if result.AttackCount != 4 {
		t.Fatalf("attackCount = %d, want 4 real attacks", result.AttackCount)
	}
	if got := energizedBreakdownCount(result, dpsEffectEnergizedChargeGain); got != 4 {
		t.Fatalf("energized gain count = %d, want only real basic attacks", got)
	}
	fourthHitMs := result.AttackTimeline[3].TimeMs
	if got := energizedBreakdownCountAt(result, dpsEffectEnergizedChargeGain, fourthHitMs); got != 1 {
		t.Fatalf("gain count at phantom trigger hit = %d, want single real-attack gain", got)
	}
}

func TestSingleAttackerDPSEnergizedDoesNotProcFromPhantomHit(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 2000
	curve := &input.Curves[0]
	energized := testEnergizedPassive()
	energized.Operations[0].PhantomHitCopyable = true
	enableDPSPassivesForTest(curve, energized, testPhantomHitPassive())
	configureEnergizedCurve(curve, 2000, 2)

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s, want ok", result.Status)
	}
	fourthHitMs := result.AttackTimeline[3].TimeMs
	if got := damageCountBySource(result, "test_energized_proc"); got != 1 {
		t.Fatalf("energized proc count = %d, want one ready proc on fourth real basic attack", got)
	}
	if got := damageCountBySourceAt(result, "test_energized_proc", fourthHitMs); got != 1 {
		t.Fatalf("energized proc count at %dms = %d, want single real-hit proc without phantom duplication", fourthHitMs, got)
	}
	if got := phantomDamageCountBySourceAt(result, "test_energized_proc", fourthHitMs); got != 0 {
		t.Fatalf("phantom energized proc count = %d, want phantom to skip energized proc/copy", got)
	}
	if got := energizedBreakdownCountAt(result, dpsEffectEnergizedChargeCheck, fourthHitMs); got != 1 {
		t.Fatalf("energized check count at phantom hit = %d, want only real basic attack charge phase", got)
	}
}

func TestSingleAttackerDPSEnergizedBlocksInvalidChargeConfig(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*model.DPSPassiveEffectV2)
		needle string
	}{
		{
			name: "missing charge key",
			mutate: func(passive *model.DPSPassiveEffectV2) {
				passive.ChargeKey = ""
			},
			needle: "requires chargeKey",
		},
		{
			name: "non-positive gain",
			mutate: func(passive *model.DPSPassiveEffectV2) {
				passive.ChargeGainPerBasicAttack = 0
			},
			needle: "requires chargeGainPerBasicAttack > 0",
		},
		{
			name: "non-positive threshold",
			mutate: func(passive *model.DPSPassiveEffectV2) {
				passive.ChargeThreshold = 0
			},
			needle: "requires chargeThreshold > 0",
		},
		{
			name: "cap below threshold",
			mutate: func(passive *model.DPSPassiveEffectV2) {
				passive.ChargeCap = 2
			},
			needle: "requires chargeCap >= chargeThreshold",
		},
		{
			name: "missing consume on trigger",
			mutate: func(passive *model.DPSPassiveEffectV2) {
				passive.ConsumeChargeOnTrigger = false
			},
			needle: "requires consumeChargeOnTrigger=true",
		},
		{
			name: "unsupported ready policy",
			mutate: func(passive *model.DPSPassiveEffectV2) {
				passive.ChargeReadyPolicy = "immediate_on_threshold"
			},
			needle: "unsupported chargeReadyPolicy",
		},
		{
			name: "unsupported proc scope",
			mutate: func(passive *model.DPSPassiveEffectV2) {
				passive.ProcScope = "all_hits"
			},
			needle: "unsupported procScope",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			input := baseSingleAttackerDPSInput()
			passive := testEnergizedPassive()
			tc.mutate(&passive)
			curve := &input.Curves[0]
			enableDPSPassivesForTest(curve, passive)

			result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
			if result.Status != "blocked" {
				t.Fatalf("status = %s, want blocked", result.Status)
			}
			if !blockedReasonContains(result, tc.needle) {
				t.Fatalf("blockedReasons = %v, want %q", result.BlockedReasons, tc.needle)
			}
		})
	}
}

func TestSingleAttackerDPSEnergizedRecordsChargeBreakdown(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1500
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, testEnergizedPassive())
	configureEnergizedCurve(curve, 1500, 1)

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s, want ok", result.Status)
	}
	required := []string{
		"chargeKey=test_energized_charge",
		"preCharge=",
		"postCharge=",
		"chargeGain=",
		"chargeThreshold=3",
		"readyBeforeHit=",
		"readyAfterHit=",
		"consumed=",
		"triggered=",
	}
	for _, kind := range []string{dpsEffectEnergizedChargeCheck, dpsEffectEnergizedChargeGain} {
		if energizedBreakdownCount(result, kind) == 0 {
			t.Fatalf("effectBreakdown missing kind %s", kind)
		}
		for _, event := range result.EffectBreakdown {
			if event.Kind != kind {
				continue
			}
			for _, needle := range required {
				if !strings.Contains(event.Message, needle) {
					t.Fatalf("breakdown %+v missing %q", event, needle)
				}
			}
		}
	}
}

func energizedBreakdownCountAt(result model.DPSCurveResultV2, kind string, timeMs int64) int {
	count := 0
	for _, event := range result.EffectBreakdown {
		if event.Kind == kind && event.TimeMs == timeMs {
			count++
		}
	}
	return count
}

func TestSingleAttackerDPSLinkedEffectDispatcherKeepsLegacyOnHitPassives(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	curve.Selection.EquipmentSet = []string{"3124"}
	curve.Selection.EnabledPassiveEffects = []string{"item_3124_guinsoos_rageblade_wrath_dps_v2"}
	curve.ResolvedSnapshot.EquipmentSet = []string{"3124"}
	curve.ResolvedSnapshot.EquipmentStats = map[string]float64{"ad": 30, "ap": 30, "attack_speed": 0.25}
	curve.ResolvedSnapshot.EnabledPassiveEffects = []string{"item_3124_guinsoos_rageblade_wrath_dps_v2"}
	curve.ResolvedSnapshot.PassiveEffects = []model.DPSPassiveEffectV2{guinsoosWrathPassive()}
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.ItemPassiveTriggers) != 1 {
		t.Fatalf("itemPassiveTriggers = %v, want one legacy on-hit trigger", result.ItemPassiveTriggers)
	}
	if !almostEqual(result.DamageBySource["guinsoos_wrath_on_hit"], 30) {
		t.Fatalf("damageBySource = %v, want legacy guinsoos on-hit damage", result.DamageBySource)
	}
}

func TestSingleAttackerDPSLinkedEffectDispatcherKeepsEveryNAndStacks(t *testing.T) {
	t.Run("every-N basic attack hit", func(t *testing.T) {
		input := baseSingleAttackerDPSInput()
		input.SimulationRules.DurationMs = 2501
		curve := &input.Curves[0]
		enableDPSPassivesForTest(curve, vayneSilverBoltsPassive())
		curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 0
		curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
		curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 3000
		curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 3000
		curve.ResolvedSnapshot.TargetSnapshot.Attributes["hp"] = 3000
		curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
		curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

		result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
		if result.Status != "ok" {
			t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
		}
		if len(result.SkillPassiveTriggers) != 1 || result.SkillPassiveTriggers[0].TimeMs != 2000 {
			t.Fatalf("skillPassiveTriggers = %+v, want every-N proc on third hit at 2000ms", result.SkillPassiveTriggers)
		}
	})

	t.Run("stack on hit", func(t *testing.T) {
		input := baseSingleAttackerDPSInput()
		input.SimulationRules.DurationMs = 2100
		curve := &input.Curves[0]
		enableDPSPassivesForTest(curve, varusBlightedQuiverPassive())
		curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 0
		curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
		curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
		curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

		result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
		if result.Status != "ok" {
			t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
		}
		if !hasBreakdown(result, dpsOpAddStack, 3) {
			t.Fatalf("effectBreakdown = %+v, want stack_on_hit to reach third stack", result.EffectBreakdown)
		}
	})
}

func TestSingleAttackerDPSLinkedEffectDispatcherKeepsPhantomHitCopyRules(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 2000
	curve := &input.Curves[0]
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 2
	enableDPSPassivesForTest(curve, testPhantomHitPassive())

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	fourthHitMs := result.AttackTimeline[3].TimeMs
	phantomSources := make([]string, 0)
	for _, event := range result.DamageTimeline {
		if event.PhantomHit && event.TimeMs == fourthHitMs {
			phantomSources = append(phantomSources, event.Source)
		}
	}
	if !sameStrings(phantomSources, []string{"test_copyable_on_hit"}) {
		t.Fatalf("phantom damage sources = %v, want only copyable on-hit damage on fourth attack", phantomSources)
	}
}

func TestSingleAttackerDPSLinkedEffectPriorityStableByInputOrder(t *testing.T) {
	t.Run("same priority keeps resolvedSnapshot order", func(t *testing.T) {
		input := baseSingleAttackerDPSInput()
		input.SimulationRules.DurationMs = 1
		first := canonicalHeroOnHitPassive()
		first.Operations[0].Source = "linked_first_on_hit"
		second := canonicalItemOnHitPassive()
		second.Operations[0].Source = "linked_second_on_hit"
		curve := &input.Curves[0]
		enableDPSPassivesForTest(curve, first, second)
		curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
		curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
		curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
		curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
		curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
		curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

		result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
		if result.Status != "ok" {
			t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
		}
		if got := damageSources(result); !sameStrings(got, []string{dpsTestDefaultBasicAttackSkillID, "linked_first_on_hit", "linked_second_on_hit"}) {
			t.Fatalf("damage source order = %v, want input-order passives after basic attack", got)
		}
	})

	t.Run("lower priority executes first", func(t *testing.T) {
		input := baseSingleAttackerDPSInput()
		input.SimulationRules.DurationMs = 1
		late := canonicalHeroOnHitPassive()
		late.Priority = 10
		late.Operations[0].Source = "linked_late_on_hit"
		early := canonicalItemOnHitPassive()
		early.Priority = 1
		early.Operations[0].Source = "linked_early_on_hit"
		curve := &input.Curves[0]
		enableDPSPassivesForTest(curve, late, early)
		curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
		curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
		curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
		curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
		curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
		curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

		result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
		if result.Status != "ok" {
			t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
		}
		if got := damageSources(result); !sameStrings(got, []string{dpsTestDefaultBasicAttackSkillID, "linked_early_on_hit", "linked_late_on_hit"}) {
			t.Fatalf("damage source order = %v, want priority-sorted passives", got)
		}
	})
}

func TestSingleAttackerDPSLinkedEffectOnHitEventTriggersOnBasicAttack(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	passive := canonicalHeroOnHitPassive()
	passive.TriggerKind = ""
	passive.Trigger = model.DPSPassiveTriggerSpecV2{Event: dpsEventOnHit}
	passive.Operations[0].Source = "linked_on_hit_event"
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, passive)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.SkillPassiveTriggers) != 1 {
		t.Fatalf("skillPassiveTriggers = %v, want one on_hit trigger", result.SkillPassiveTriggers)
	}
	if !almostEqual(result.DamageBySource["linked_on_hit_event"], 10) {
		t.Fatalf("damageBySource = %v, want on_hit passive damage on basic attack", result.DamageBySource)
	}
}

func TestSingleAttackerDPSLinkedEffectOnSpellHitDoesNotTriggerOnBasicAttack(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 2000
	passive := testPhantomHitPassive()
	passive.Trigger = model.DPSPassiveTriggerSpecV2{Event: dpsEventOnSpellHit}
	curve := &input.Curves[0]
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 2
	enableDPSPassivesForTest(curve, passive)
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.ItemPassiveTriggers) != 0 {
		t.Fatalf("itemPassiveTriggers = %v, want no spell-hit passive proc during basic attack", result.ItemPassiveTriggers)
	}
	if result.DamageBySource["test_copyable_on_hit"] != 0 {
		t.Fatalf("damageBySource = %v, want no copyable on-hit damage from spell-hit passive", result.DamageBySource)
	}
	for _, event := range result.EffectBreakdown {
		if event.Kind == dpsOpAddStack {
			t.Fatalf("effectBreakdown = %+v, want no add_stack from spell-hit passive during basic attack", result.EffectBreakdown)
		}
	}
	for _, event := range result.DamageTimeline {
		if event.Source == "test_copyable_on_hit" || event.PhantomHit {
			t.Fatalf("damageTimeline = %+v, want no spell-hit passive or phantom damage during basic attack", result.DamageTimeline)
		}
	}
}

func TestSingleAttackerDPSBlocksUnsupportedLinkedEffectTrigger(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*model.DPSPassiveEffectV2)
		needle string
	}{
		{
			name: "unsupported trigger event",
			mutate: func(passive *model.DPSPassiveEffectV2) {
				passive.TriggerKind = ""
				passive.Trigger = model.DPSPassiveTriggerSpecV2{Event: "on_cast_complete"}
			},
			needle: "unsupported trigger.event on_cast_complete",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			input := baseSingleAttackerDPSInput()
			passive := canonicalHeroOnHitPassive()
			tc.mutate(&passive)
			curve := &input.Curves[0]
			enableDPSPassivesForTest(curve, passive)

			result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
			if result.Status != "blocked" {
				t.Fatalf("status = %s, want blocked", result.Status)
			}
			if !blockedReasonContains(result, tc.needle) {
				t.Fatalf("blockedReasons = %v, want %q", result.BlockedReasons, tc.needle)
			}
		})
	}
}

func syntheticThornmailRetaliationPassive() model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:      "item_thornmail_retaliation_test",
		SourceCategory: "item_passive",
		SourceID:       "item_thornmail",
		SourceType:     "item",
		TriggerID:      "thornmail_reflect",
		OwnerRole:      "target",
		Trigger: model.DPSPassiveTriggerSpecV2{
			Event: dpsEventOnDamageTaken,
			Matcher: model.DPSPassiveTriggerMatcherV2{
				DamageTypes:    []string{"physical"},
				ActionTypes:    model.TypeMatcherV2{Any: []string{"action/basic_attack"}},
				ExcludePhantom: true,
			},
		},
		Operations: []model.DPSPassiveOperationV2{{
			Kind:       dpsOpDamage,
			Source:     "thornmail_reflect",
			TargetRole: "attacker",
			DamageType: "magic",
			Amount:     20,
		}},
	}
}

func syntheticBlackCleaverArmorShredPassive() model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:      "item_black_cleaver_armor_shred_test",
		SourceCategory: "item_passive",
		SourceID:       "item_black_cleaver",
		SourceType:     "item",
		TriggerID:      "black_cleaver_carve",
		OwnerRole:      "attacker",
		Trigger: model.DPSPassiveTriggerSpecV2{
			Event: dpsEventOnDamageDealt,
			Matcher: model.DPSPassiveTriggerMatcherV2{
				DamageTypes:    []string{"physical"},
				ExcludePhantom: true,
			},
		},
		Operations: []model.DPSPassiveOperationV2{
			{
				Kind:        dpsOpAddStack,
				Source:      "black_cleaver_carve_stack",
				StackKey:    "black_cleaver_carve",
				MaxStacks:   5,
				DurationMs:  6000,
				RefreshMode: "refresh",
			},
			{
				Kind:         dpsOpStatModifier,
				Source:       "black_cleaver_armor_shred",
				TargetRole:   "target",
				StackKey:     "black_cleaver_carve",
				AttrKey:      "armor",
				ModifierMode: "percent",
				Value:        -0.04,
				PerStack:     true,
			},
		},
	}
}

func TestSingleAttackerDPSTargetOwnedOnDamageTakenRetaliates(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1000
	curve := &input.Curves[0]
	enableTargetDPSPassivesForTest(curve, "3075", syntheticThornmailRetaliationPassive())
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.ItemPassiveTriggers) != 1 {
		t.Fatalf("itemPassiveTriggers = %v, want one retaliation trigger", result.ItemPassiveTriggers)
	}
	if len(result.AttackerDamageTimeline) != 1 {
		t.Fatalf("attackerDamageTimeline = %+v, want one retaliation evidence event", result.AttackerDamageTimeline)
	}
	retaliation := result.AttackerDamageTimeline[0]
	if retaliation.Source != "thornmail_reflect" || retaliation.DamageType != "magic" || !almostEqual(retaliation.FinalDamage, 20) {
		t.Fatalf("attackerDamageTimeline[0] = %+v, want thornmail_reflect magic retaliation 20", retaliation)
	}
	if !almostEqual(result.AttackerDamageBySource["thornmail_reflect"], 20) {
		t.Fatalf("attackerDamageBySource = %v, want retaliation tracked separately from target damage", result.AttackerDamageBySource)
	}
	if result.DamageBySource["thornmail_reflect"] != 0 {
		t.Fatalf("damageBySource = %v, want retaliation excluded from target damage totals", result.DamageBySource)
	}
	if !almostEqual(result.TotalDamage, 100) {
		t.Fatalf("totalDamage = %.4f, want only basic attack target damage", result.TotalDamage)
	}
	targetHPAfterHit := result.DamageTimeline[0].TargetHPAfter
	if !almostEqual(targetHPAfterHit, 900) {
		t.Fatalf("target hp after hit = %.4f, want retaliation to leave target hp unchanged at 900", targetHPAfterHit)
	}
}

func TestSingleAttackerDPSTargetOwnedRetaliationDoesNotRecurse(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 2000
	curve := &input.Curves[0]
	enableTargetDPSPassivesForTest(curve, "3075", syntheticThornmailRetaliationPassive())
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.AttackerDamageTimeline) != 2 {
		t.Fatalf("attackerDamageTimeline length = %d, want exactly one retaliation per basic attack without recursion", len(result.AttackerDamageTimeline))
	}
	if !almostEqual(result.AttackerDamageBySource["thornmail_reflect"], 40) {
		t.Fatalf("attackerDamageBySource = %v, want linear retaliation total 40", result.AttackerDamageBySource)
	}
	if len(result.ItemPassiveTriggers) != 2 {
		t.Fatalf("itemPassiveTriggers = %v, want one trigger per attack", result.ItemPassiveTriggers)
	}
}

func TestSingleAttackerDPSAttackerOwnedPhysicalDamageAddsTargetArmorShredStack(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1000
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, syntheticBlackCleaverArmorShredPassive())
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 100
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if !almostEqual(result.DamageTimeline[0].FinalDamage, 50) {
		t.Fatalf("first hit finalDamage = %.4f, want original armor mitigation before shred applies", result.DamageTimeline[0].FinalDamage)
	}
	if maxBreakdownAmount(result, dpsOpAddStack) != 1 {
		t.Fatalf("effectBreakdown = %+v, want one black_cleaver carve stack after first physical hit", result.EffectBreakdown)
	}
	foundArmorShred := false
	for _, entry := range result.EffectBreakdown {
		if entry.Kind == dpsOpStatModifier && entry.Source == "black_cleaver_armor_shred" {
			foundArmorShred = true
			if !almostEqual(entry.Amount, 96) {
				t.Fatalf("armor shred breakdown amount = %.4f, want target armor reduced to 96", entry.Amount)
			}
		}
	}
	if !foundArmorShred {
		t.Fatalf("effectBreakdown = %+v, want target armor shred evidence", result.EffectBreakdown)
	}
}

func TestSingleAttackerDPSTargetArmorShredAffectsNextPhysicalHit(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 2000
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, syntheticBlackCleaverArmorShredPassive())
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 100
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.DamageTimeline) < 2 {
		t.Fatalf("damageTimeline = %+v, want at least two basic attack hits", result.DamageTimeline)
	}
	if !almostEqual(result.DamageTimeline[0].FinalDamage, 50) {
		t.Fatalf("first hit finalDamage = %.4f, want 50 with base armor 100", result.DamageTimeline[0].FinalDamage)
	}
	secondHit := result.DamageTimeline[1].FinalDamage
	wantSecondHit := 100.0 * 100.0 / (100.0 + 96.0)
	if !almostEqual(secondHit, wantSecondHit) {
		t.Fatalf("second hit finalDamage = %.4f, want %.4f after one shred stack", secondHit, wantSecondHit)
	}
	if secondHit <= result.DamageTimeline[0].FinalDamage {
		t.Fatalf("damage timeline = %+v, want second physical hit to increase after armor shred", result.DamageTimeline)
	}
}

func TestSingleAttackerDPSTargetOwnedPassiveMergeDoesNotRegressAttackerPassives(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 2000
	curve := &input.Curves[0]
	enableMixedDPSPassivesForTest(
		curve,
		"3075",
		[]model.DPSPassiveEffectV2{syntheticBlackCleaverArmorShredPassive()},
		[]model.DPSPassiveEffectV2{syntheticThornmailRetaliationPassive()},
	)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 100
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if maxBreakdownAmount(result, dpsOpAddStack) != 2 {
		t.Fatalf("effectBreakdown = %+v, want black cleaver stacks on both hits", result.EffectBreakdown)
	}
	if !almostEqual(result.AttackerDamageBySource["thornmail_reflect"], 40) {
		t.Fatalf("attackerDamageBySource = %v, want thornmail retaliation on both hits", result.AttackerDamageBySource)
	}
	if len(result.DamageTimeline) < 2 || !almostEqual(result.DamageTimeline[1].FinalDamage, 100.0*100.0/(100.0+96.0)) {
		t.Fatalf("damageTimeline = %+v, want second hit to benefit from black cleaver shred after merge", result.DamageTimeline)
	}
}

func TestSingleAttackerDPSPhantomHitDoesNotCopyTargetRetaliation(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 2000
	curve := &input.Curves[0]
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 2
	enableMixedDPSPassivesForTest(
		curve,
		"3075",
		[]model.DPSPassiveEffectV2{testPhantomHitPassive()},
		[]model.DPSPassiveEffectV2{syntheticThornmailRetaliationPassive()},
	)
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	fourthHitMs := result.AttackTimeline[3].TimeMs
	if len(phantomDamageSourcesAt(result, fourthHitMs)) == 0 {
		t.Fatalf("damageTimeline = %+v, want phantom hit evidence on fourth attack", result.DamageTimeline)
	}
	retaliationAtFourthHit := 0
	for _, event := range result.AttackerDamageTimeline {
		if event.Source == "thornmail_reflect" && event.TimeMs == fourthHitMs {
			retaliationAtFourthHit++
		}
	}
	if retaliationAtFourthHit != 1 {
		t.Fatalf("attackerDamageTimeline = %+v, want one retaliation at real fourth hit without phantom duplication", result.AttackerDamageTimeline)
	}
	if result.AttackerDamageBySource["thornmail_reflect"] != 80 {
		t.Fatalf("attackerDamageBySource = %v, want retaliation only from four real basic attacks", result.AttackerDamageBySource)
	}
	thornmailTriggerCount := 0
	for _, trigger := range result.ItemPassiveTriggers {
		if trigger.TriggerID == "thornmail_reflect" {
			thornmailTriggerCount++
		}
	}
	if thornmailTriggerCount != 4 {
		t.Fatalf("itemPassiveTriggers = %v, want thornmail to proc once per real hit only", result.ItemPassiveTriggers)
	}
}

func TestSingleAttackerDPSBlocksInvalidOwnerRoleOrTargetRole(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*model.DPSPassiveEffectV2)
		needle string
	}{
		{
			name: "invalid ownerRole",
			mutate: func(passive *model.DPSPassiveEffectV2) {
				passive.OwnerRole = "ally"
			},
			needle: "unsupported ownerRole ally",
		},
		{
			name: "invalid operation targetRole",
			mutate: func(passive *model.DPSPassiveEffectV2) {
				passive.Operations[0].TargetRole = "self"
			},
			needle: "unsupported operation targetRole self",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			input := baseSingleAttackerDPSInput()
			passive := syntheticThornmailRetaliationPassive()
			tc.mutate(&passive)
			curve := &input.Curves[0]
			enableDPSPassivesForTest(curve, passive)

			result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
			if result.Status != "blocked" {
				t.Fatalf("status = %s, want blocked", result.Status)
			}
			if !blockedReasonContains(result, tc.needle) {
				t.Fatalf("blockedReasons = %v, want %q", result.BlockedReasons, tc.needle)
			}
		})
	}
}

func phantomHitPassiveWithRepeat(priority int, passiveID, copySource, repeatTag string) model.DPSPassiveEffectV2 {
	stackKey := passiveID + "_stack"
	return model.DPSPassiveEffectV2{
		PassiveID:      passiveID,
		Priority:       priority,
		SourceCategory: "item_passive",
		SourceID:       passiveID + "_item",
		SourceType:     "item",
		TriggerID:      passiveID + "_trigger",
		TriggerKind:    dpsTriggerOnBasicAttackHit,
		Operations: []model.DPSPassiveOperationV2{
			{Kind: dpsOpAddStack, Source: stackKey, StackKey: stackKey, MaxStacks: 4, RefreshMode: "refresh"},
			{Kind: dpsOpDamage, Source: copySource, DamageType: "magic", Amount: 25, PhantomHitCopyable: true},
			{
				Kind:          dpsOpPhantomHitOnHitRepeat,
				Source:        passiveID + "_repeat",
				StackKey:      stackKey,
				TriggerStacks: 4,
				RepeatCount:   1,
				RepeatTag:     repeatTag,
				RepeatScope:   dpsRepeatScopeCopyableOnHit,
			},
		},
	}
}

func phantomDamageSourcesAt(result model.DPSCurveResultV2, timeMs int64) []string {
	sources := make([]string, 0)
	for _, event := range result.DamageTimeline {
		if event.TimeMs == timeMs && event.PhantomHit {
			sources = append(sources, event.Source)
		}
	}
	return sources
}

func TestSingleAttackerDPSPhantomHitRepeatPriorityStableByInputOrder(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 2000
	late := phantomHitPassiveWithRepeat(10, "phantom_late_passive", "phantom_late_damage", "late_repeat")
	early := phantomHitPassiveWithRepeat(1, "phantom_early_passive", "phantom_early_damage", "early_repeat")
	curve := &input.Curves[0]
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 2
	enableDPSPassivesForTest(curve, late, early)
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	fourthHitMs := result.AttackTimeline[3].TimeMs
	if got := phantomDamageSourcesAt(result, fourthHitMs); !sameStrings(got, []string{"phantom_early_damage", "phantom_late_damage"}) {
		t.Fatalf("phantom damage source order at %dms = %v, want priority-sorted repeats not input order", fourthHitMs, got)
	}
}

func TestSingleAttackerDPSBlocksUnsupportedOperationTargetRole(t *testing.T) {
	cases := []struct {
		name    string
		passive model.DPSPassiveEffectV2
		needle  string
	}{
		{
			name: "apply_dot targetRole attacker",
			passive: func() model.DPSPassiveEffectV2 {
				passive := canonicalDotOnlyPassive()
				passive.Operations[0].TargetRole = "attacker"
				return passive
			}(),
			needle: "apply_dot does not support targetRole attacker",
		},
		{
			name: "trigger_damage_at_stacks targetRole attacker",
			passive: func() model.DPSPassiveEffectV2 {
				passive := kaisaPlasmaPassive()
				passive.Operations[2].TargetRole = "attacker"
				return passive
			}(),
			needle: "trigger_damage_at_stacks does not support targetRole attacker",
		},
		{
			name: "add_stack targetRole attacker",
			passive: func() model.DPSPassiveEffectV2 {
				passive := syntheticBlackCleaverArmorShredPassive()
				passive.Operations[0].TargetRole = "attacker"
				return passive
			}(),
			needle: "add_stack does not support targetRole",
		},
		{
			name: "add_stack targetRole target",
			passive: func() model.DPSPassiveEffectV2 {
				passive := syntheticBlackCleaverArmorShredPassive()
				passive.Operations[0].TargetRole = "target"
				return passive
			}(),
			needle: "add_stack does not support targetRole",
		},
		{
			name: "phantom_hit_on_hit_repeat targetRole attacker",
			passive: func() model.DPSPassiveEffectV2 {
				passive := testPhantomHitPassive()
				passive.Operations[2].TargetRole = "attacker"
				return passive
			}(),
			needle: "phantom_hit_on_hit_repeat does not support targetRole",
		},
		{
			name: "apply_dot targetRole target allowed",
			passive: func() model.DPSPassiveEffectV2 {
				passive := canonicalDotOnlyPassive()
				passive.Operations[0].TargetRole = "target"
				return passive
			}(),
			needle: "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			input := baseSingleAttackerDPSInput()
			curve := &input.Curves[0]
			enableDPSPassivesForTest(curve, tc.passive)

			result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
			if tc.needle == "" {
				if result.Status != "ok" {
					t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
				}
				return
			}
			if result.Status != "blocked" {
				t.Fatalf("status = %s, want blocked", result.Status)
			}
			if !blockedReasonContains(result, tc.needle) {
				t.Fatalf("blockedReasons = %v, want %q", result.BlockedReasons, tc.needle)
			}
		})
	}
}

func syntheticIncomingDamageModifierPassive() model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:      "item_randuins_incoming_reduction_test",
		SourceCategory: "item_passive",
		SourceID:       "item_randuins",
		SourceType:     "item",
		TriggerID:      "randuins_incoming_reduction",
		OwnerRole:      "target",
		Trigger: model.DPSPassiveTriggerSpecV2{
			Event: dpsEventOnDamageTaken,
			Matcher: model.DPSPassiveTriggerMatcherV2{
				DamageTypes:    []string{"physical"},
				ExcludePhantom: true,
			},
		},
		Operations: []model.DPSPassiveOperationV2{{
			Kind:         dpsOpDamageModifier,
			Source:       "randuins_incoming_reduction",
			TargetRole:   "target",
			ModifierMode: "percent",
			Value:        -0.2,
			ValuePhase:   "incoming",
		}},
	}
}

func syntheticCritOnlyIncomingDamageModifierPassive() model.DPSPassiveEffectV2 {
	passive := syntheticIncomingDamageModifierPassive()
	passive.PassiveID = "item_crit_only_incoming_reduction_test"
	passive.SourceID = "item_crit_only_reduction"
	passive.TriggerID = "crit_only_incoming_reduction"
	passive.Operations[0].Source = "crit_only_incoming_reduction"
	passive.Operations[0].CritOnly = true
	return passive
}

func syntheticLudenSpellHitPassive() model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:      "item_luden_spell_hit_test",
		SourceCategory: "item_passive",
		SourceID:       "item_luden",
		SourceType:     "item",
		TriggerID:      "luden_spell_hit",
		OwnerRole:      "attacker",
		Trigger: model.DPSPassiveTriggerSpecV2{
			Event: dpsEventOnSpellHit,
			Matcher: model.DPSPassiveTriggerMatcherV2{
				DamageTypes: []string{"magic"},
				ActionTypes: model.TypeMatcherV2{Any: []string{"action/cast_skill"}},
				EffectTags:  model.TypeMatcherV2{Any: []string{"skill_tag/spell_damage"}},
			},
		},
		Operations: []model.DPSPassiveOperationV2{{
			Kind:       dpsOpDamage,
			Source:     "luden_spell_hit_proc",
			DamageType: "magic",
			Amount:     40,
		}},
	}
}

func dispatchSyntheticSpellHitForTest(t *testing.T, passives ...model.DPSPassiveEffectV2) model.DPSCurveResultV2 {
	t.Helper()
	bundle := compileDPSTestBundle(t)
	input := baseSingleAttackerDPSInput()
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, passives...)
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := model.DPSCurveResultV2{
		Status:                  dpsStatusOK,
		DamageTimeline:          make([]model.DPSDamageEventV2, 0),
		DamageByType:            map[string]float64{},
		DamageBySource:          map[string]float64{},
		SkillPassiveTriggers:    make([]model.DPSPassiveTriggerV2, 0),
		ItemPassiveTriggers:     make([]model.DPSPassiveTriggerV2, 0),
		ExternalPassiveTriggers: make([]model.DPSPassiveTriggerV2, 0),
		EffectBreakdown:         make([]model.DPSEffectBreakdownV2, 0),
		BlockedReasons:          make([]string, 0),
	}
	rules := normalizeDPSRules(input.SimulationRules)
	state := newDPSCurveState(bundle, rules, *curve, &result, curve.ResolvedSnapshot.AttackerSnapshot, curve.ResolvedSnapshot.TargetSnapshot)
	if result.Status == dpsStatusBlocked {
		t.Fatalf("newDPSCurveState blocked: %v", result.BlockedReasons)
	}
	ctx := dpsCombatEventContext{
		Event:          dpsEventOnSpellHit,
		TimeMs:         500,
		SourceRole:     dpsRoleAttacker,
		TargetRole:     dpsRoleTarget,
		ActionID:       "synthetic_spell",
		ActionTypes:    []string{"action/cast_skill"},
		EffectTypes:    []string{string(model.EffectTypeDealDamage)},
		EffectTags:     []string{"skill_tag/spell_damage"},
		SourceType:     "spell",
		SourceCategory: "spell",
		SourceID:       "synthetic_spell",
		DamageType:     "magic",
		RawDamage:      100,
		TargetHPBefore: state.targetHP,
		IsSpell:        true,
		IsOnHit:        true,
	}
	state.dispatchDPSLinkedEffects(ctx)
	return result
}

func TestSingleAttackerDPSIncomingDamageModifierAppliesBeforeTimeline(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, syntheticIncomingDamageModifierPassive())
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.DamageTimeline) != 1 {
		t.Fatalf("damageTimeline = %+v, want one basic attack damage event", result.DamageTimeline)
	}
	basicAttack := result.DamageTimeline[0]
	if !almostEqual(basicAttack.RawDamage, 80) || !almostEqual(basicAttack.FinalDamage, 80) {
		t.Fatalf("basic attack damage = raw %.4f final %.4f, want 80 before and after zero armor", basicAttack.RawDamage, basicAttack.FinalDamage)
	}
	if !almostEqual(result.TotalDamage, 80) {
		t.Fatalf("totalDamage = %.4f, want incoming modifier applied before timeline", result.TotalDamage)
	}
	if len(result.ItemPassiveTriggers) != 1 {
		t.Fatalf("itemPassiveTriggers = %v, want one pre-damage modifier trigger", result.ItemPassiveTriggers)
	}
	if !effectBreakdownMessageContains(result, dpsOpDamageModifier, "valuePhase=incoming raw=100 modified=80 value=-0.2") {
		t.Fatalf("effectBreakdown = %+v, want incoming damage modifier evidence", result.EffectBreakdown)
	}
	modifierTriggerCount := 0
	for _, trigger := range result.ItemPassiveTriggers {
		if trigger.TriggerID == "randuins_incoming_reduction" {
			modifierTriggerCount++
		}
	}
	if modifierTriggerCount != 1 {
		t.Fatalf("itemPassiveTriggers = %v, want no duplicate post-damage trigger for pure damage_modifier passive", result.ItemPassiveTriggers)
	}
}

func syntheticHPChangeIncomingPhysicalBucketPassive(value float64) model.DPSPassiveEffectV2 {
	passive := syntheticIncomingDamageModifierPassive()
	passive.PassiveID = "item_hp_change_incoming_physical_test"
	passive.SourceID = "item_hp_change_incoming_physical"
	passive.TriggerID = "hp_change_incoming_physical"
	passive.Operations = []model.DPSPassiveOperationV2{{
		Kind:       dpsOpDamageModifier,
		Source:     "hp_change_incoming_physical",
		TargetRole: "target",
		BucketKey:  "incoming_physical_reduction",
		Value:      value,
	}}
	return passive
}

func syntheticHPChangeIncomingMagicBucketPassive(value float64) model.DPSPassiveEffectV2 {
	passive := syntheticIncomingDamageModifierPassive()
	passive.PassiveID = "item_hp_change_incoming_magic_test"
	passive.SourceID = "item_hp_change_incoming_magic"
	passive.TriggerID = "hp_change_incoming_magic"
	passive.Trigger.Matcher.DamageTypes = []string{"magic"}
	passive.Operations = []model.DPSPassiveOperationV2{{
		Kind:       dpsOpDamageModifier,
		Source:     "hp_change_incoming_magic",
		TargetRole: "target",
		BucketKey:  "incoming_magic_reduction",
		Value:      value,
	}}
	return passive
}

func syntheticHPChangeFinalPostMitigationBucketPassive(value float64) model.DPSPassiveEffectV2 {
	passive := syntheticIncomingDamageModifierPassive()
	passive.PassiveID = "item_hp_change_final_post_test"
	passive.SourceID = "item_hp_change_final_post"
	passive.TriggerID = "hp_change_final_post"
	passive.Trigger.Matcher.DamageTypes = []string{"magic"}
	passive.Operations = []model.DPSPassiveOperationV2{{
		Kind:       dpsOpDamageModifier,
		Source:     "hp_change_final_post",
		TargetRole: "target",
		BucketKey:  "final_post_mitigation",
		Value:      value,
	}}
	return passive
}

func syntheticHPChangeFlatPostPercentBucketPassive(value float64) model.DPSPassiveEffectV2 {
	passive := syntheticIncomingDamageModifierPassive()
	passive.PassiveID = "item_hp_change_flat_post_test"
	passive.SourceID = "item_hp_change_flat_post"
	passive.TriggerID = "hp_change_flat_post"
	passive.Operations = []model.DPSPassiveOperationV2{{
		Kind:       dpsOpDamageModifier,
		Source:     "hp_change_flat_post",
		TargetRole: "target",
		BucketKey:  "flat_post_percent",
		Value:      value,
	}}
	return passive
}

func syntheticHPChangeOutgoingAddPassive(value float64) model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:      "item_hp_change_outgoing_add_test",
		SourceCategory: "item_passive",
		SourceID:       "item_hp_change_outgoing_add",
		SourceType:     "item",
		TriggerID:      "hp_change_outgoing_add",
		OwnerRole:      "attacker",
		Trigger: model.DPSPassiveTriggerSpecV2{
			Event: dpsEventOnDamageDealt,
			Matcher: model.DPSPassiveTriggerMatcherV2{
				DamageTypes:    []string{"physical"},
				ExcludePhantom: true,
			},
		},
		Operations: []model.DPSPassiveOperationV2{{
			Kind:       dpsOpDamageModifier,
			Source:     "hp_change_outgoing_add",
			TargetRole: "attacker",
			BucketKey:  "outgoing_add_priority_late",
			Value:      value,
		}},
	}
}

func syntheticHPChangeOutgoingPriorityPairPassive(multiplyFactor float64, addPercent float64) model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:      "item_hp_change_outgoing_priority_pair_test",
		SourceCategory: "item_passive",
		SourceID:       "item_hp_change_outgoing_priority_pair",
		SourceType:     "item",
		TriggerID:      "hp_change_outgoing_priority_pair",
		OwnerRole:      "attacker",
		Trigger: model.DPSPassiveTriggerSpecV2{
			Event: dpsEventOnDamageDealt,
			Matcher: model.DPSPassiveTriggerMatcherV2{
				DamageTypes:    []string{"physical"},
				ExcludePhantom: true,
			},
		},
		Operations: []model.DPSPassiveOperationV2{
			{
				Kind:       dpsOpDamageModifier,
				Source:     "hp_change_outgoing_add",
				TargetRole: "attacker",
				BucketKey:  "outgoing_add_priority_late",
				Value:      addPercent,
			},
			{
				Kind:       dpsOpDamageModifier,
				Source:     "hp_change_outgoing_multiply",
				TargetRole: "attacker",
				BucketKey:  "outgoing_multiply_priority_early",
				Value:      multiplyFactor,
			},
		},
	}
}

func TestSingleAttackerDPSHPChangeIncomingPercentMatchesLegacyDamageModifier(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	enableTargetDPSPassivesForTest(curve, "item_hp_change_incoming_physical", syntheticHPChangeIncomingPhysicalBucketPassive(-0.2))
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.DamageTimeline) != 1 {
		t.Fatalf("damageTimeline = %+v, want one basic attack damage event", result.DamageTimeline)
	}
	basicAttack := result.DamageTimeline[0]
	if !almostEqual(basicAttack.RawDamage, 80) || !almostEqual(basicAttack.FinalDamage, 80) {
		t.Fatalf("basic attack damage = raw %.4f final %.4f, want 80 before and after zero armor", basicAttack.RawDamage, basicAttack.FinalDamage)
	}
	if !almostEqual(result.TotalDamage, 80) {
		t.Fatalf("totalDamage = %.4f, want hp_change incoming bucket applied before timeline", result.TotalDamage)
	}
	if len(result.ItemPassiveTriggers) != 1 {
		t.Fatalf("itemPassiveTriggers = %v, want one bucket modifier trigger", result.ItemPassiveTriggers)
	}
	if !effectBreakdownMessageContains(result, dpsEffectCoefficientBucket, "domain=hp_change stageKey="+dpsHPChangeStageIncomingPreMitigation+" bucketKey=incoming_physical_reduction aggregationMode=add valueUnit=percent_delta raw=100 result=80") {
		t.Fatalf("effectBreakdown = %+v, want coefficient_bucket evidence", result.EffectBreakdown)
	}
	bucketEvidence := findCoefficientBucketEffectBreakdown(result, "bucketKey=incoming_physical_reduction aggregationMode=add valueUnit=percent_delta raw=100 result=80")
	if bucketEvidence == nil {
		t.Fatalf("effectBreakdown = %+v, want structured coefficient_bucket evidence", result.EffectBreakdown)
	}
	cb := bucketEvidence.CoefficientBucket
	if cb.Domain != "hp_change" || cb.BucketKey != "incoming_physical_reduction" || !almostEqual(cb.Raw, 100) || !almostEqual(cb.Result, 80) {
		t.Fatalf("coefficientBucket = %+v, want hp_change incoming_physical_reduction raw=100 result=80", cb)
	}
	if len(cb.Candidates) == 0 {
		t.Fatalf("coefficientBucket.candidates = %+v, want non-empty applied candidates", cb.Candidates)
	}
	first := cb.Candidates[0]
	if !first.Applied || first.Source == "" || first.SourceType == "" || first.PassiveID == "" || first.OperationKind == "" {
		t.Fatalf("coefficientBucket.candidates[0] = %+v, want applied candidate metadata", first)
	}
}

func TestSingleAttackerDPSHPChangeSameBucketAdditivePercent(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	passive := syntheticHPChangeIncomingPhysicalBucketPassive(-0.2)
	passive.Operations = append(passive.Operations, model.DPSPassiveOperationV2{
		Kind:       dpsOpDamageModifier,
		Source:     "hp_change_incoming_physical_second",
		TargetRole: "target",
		BucketKey:  "incoming_physical_reduction",
		Value:      -0.1,
	})
	enableTargetDPSPassivesForTest(curve, "item_hp_change_incoming_physical", passive)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.DamageTimeline) != 1 {
		t.Fatalf("damageTimeline = %+v, want one damage event", result.DamageTimeline)
	}
	if !almostEqual(result.DamageTimeline[0].FinalDamage, 70) || !almostEqual(result.TotalDamage, 70) {
		t.Fatalf("damage = raw %.4f final %.4f total %.4f, want additive bucket result 70 not serial 72",
			result.DamageTimeline[0].RawDamage, result.DamageTimeline[0].FinalDamage, result.TotalDamage)
	}
}

func TestSingleAttackerDPSHPChangeMagicPreMitigationBeforeResistance(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	curve.ResolvedSnapshot.BasicAttackActions = nil
	curve.ResolvedSnapshot.ActiveActions = []model.DPSActiveActionRefV2{{
		ActionID:   dpsTestCooldownSkillActionID,
		SkillID:    dpsTestCooldownSkillSkillID,
		Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}, Tags: []string{"skill_tag/spell_damage"}},
	}}
	enableTargetDPSPassivesForTest(curve, "item_hp_change_incoming_magic", syntheticHPChangeIncomingMagicBucketPassive(-0.2))
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ap"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 100

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.DamageTimeline) != 1 {
		t.Fatalf("damageTimeline = %+v, want one magic skill damage event", result.DamageTimeline)
	}
	if !almostEqual(result.DamageTimeline[0].FinalDamage, 40) || !almostEqual(result.TotalDamage, 40) {
		t.Fatalf("damage = raw %.4f final %.4f total %.4f, want 40 after incoming bucket and MR 100",
			result.DamageTimeline[0].RawDamage, result.DamageTimeline[0].FinalDamage, result.TotalDamage)
	}
}

func TestSingleAttackerDPSHPChangeFinalPostMitigationAfterResistance(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	curve.ResolvedSnapshot.BasicAttackActions = nil
	curve.ResolvedSnapshot.ActiveActions = []model.DPSActiveActionRefV2{{
		ActionID:   dpsTestCooldownSkillActionID,
		SkillID:    dpsTestCooldownSkillSkillID,
		Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}, Tags: []string{"skill_tag/spell_damage"}},
	}}
	enableTargetDPSPassivesForTest(curve, "item_hp_change_final_post", syntheticHPChangeFinalPostMitigationBucketPassive(-0.2))
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ap"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 100

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.DamageTimeline) != 1 {
		t.Fatalf("damageTimeline = %+v, want one magic skill damage event", result.DamageTimeline)
	}
	if !almostEqual(result.DamageTimeline[0].FinalDamage, 40) || !almostEqual(result.TotalDamage, 40) {
		t.Fatalf("damage = raw %.4f final %.4f total %.4f, want 40 after MR 100 then final/post -20%%",
			result.DamageTimeline[0].RawDamage, result.DamageTimeline[0].FinalDamage, result.TotalDamage)
	}
}

func TestSingleAttackerDPSHPChangeFlatPostPercentClampsToZero(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	enableTargetDPSPassivesForTest(
		curve,
		"item_hp_change_flat_post",
		syntheticHPChangeIncomingPhysicalBucketPassive(-0.3),
		syntheticHPChangeFlatPostPercentBucketPassive(-80),
	)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.DamageTimeline) != 1 {
		t.Fatalf("damageTimeline = %+v, want one damage event", result.DamageTimeline)
	}
	if !almostEqual(result.DamageTimeline[0].FinalDamage, 0) || !almostEqual(result.TotalDamage, 0) {
		t.Fatalf("damage = raw %.4f final %.4f total %.4f, want flat post_percent clamped to 0",
			result.DamageTimeline[0].RawDamage, result.DamageTimeline[0].FinalDamage, result.TotalDamage)
	}
}

func TestSingleAttackerDPSHPChangeOutgoingAttackerOwnedDamageDealtAppliesBeforeMitigation(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, syntheticHPChangeOutgoingAddPassive(0.2))
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.DamageTimeline) != 1 {
		t.Fatalf("damageTimeline = %+v, want one basic attack damage event", result.DamageTimeline)
	}
	basicAttack := result.DamageTimeline[0]
	if !almostEqual(basicAttack.RawDamage, 120) || !almostEqual(basicAttack.FinalDamage, 120) {
		t.Fatalf("basic attack damage = raw %.4f final %.4f, want outgoing bucket applied before mitigation",
			basicAttack.RawDamage, basicAttack.FinalDamage)
	}
	if !almostEqual(result.TotalDamage, 120) {
		t.Fatalf("totalDamage = %.4f, want outgoing bucket applied before timeline", result.TotalDamage)
	}
	modifierTriggerCount := 0
	for _, trigger := range result.ItemPassiveTriggers {
		if trigger.TriggerID == "hp_change_outgoing_add" {
			modifierTriggerCount++
		}
	}
	if modifierTriggerCount != 1 {
		t.Fatalf("itemPassiveTriggers = %v, want one outgoing bucket trigger without post-dispatch duplicate", result.ItemPassiveTriggers)
	}
	if !effectBreakdownMessageContains(result, dpsEffectCoefficientBucket, "domain=hp_change stageKey="+dpsHPChangeStageOutgoingPreMitigation+" bucketKey=outgoing_add_priority_late aggregationMode=add valueUnit=percent_delta raw=100 result=120") {
		t.Fatalf("effectBreakdown = %+v, want outgoing coefficient_bucket evidence", result.EffectBreakdown)
	}
}

func TestSingleAttackerDPSHPChangeBucketPriorityOrdersBeforeID(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, syntheticHPChangeOutgoingPriorityPairPassive(2.0, 0.2))
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.DamageTimeline) != 1 {
		t.Fatalf("damageTimeline = %+v, want one basic attack damage event", result.DamageTimeline)
	}
	if !almostEqual(result.DamageTimeline[0].RawDamage, 240) || !almostEqual(result.DamageTimeline[0].FinalDamage, 240) || !almostEqual(result.TotalDamage, 240) {
		t.Fatalf("damage = raw %.4f final %.4f total %.4f, want priority-ordered buckets 100 -> 200 -> 240 not ID order 220",
			result.DamageTimeline[0].RawDamage, result.DamageTimeline[0].FinalDamage, result.TotalDamage)
	}
}

func TestSingleAttackerDPSHPChangeConditionMaxHPGatesCandidate(t *testing.T) {
	condition := model.DPSModifierConditionV2{
		Metric:      "max_hp",
		SubjectRole: "target",
		Operator:    "gte",
		Value:       1500,
	}
	passive := syntheticHPChangeIncomingPhysicalBucketPassive(-0.2)
	passive.Operations[0].Conditions = []model.DPSModifierConditionV2{condition}

	setup := func(t *testing.T, targetMaxHP float64) model.DPSCurveResultV2 {
		t.Helper()
		input := baseSingleAttackerDPSInput()
		input.SimulationRules.DurationMs = 1
		curve := &input.Curves[0]
		enableTargetDPSPassivesForTest(curve, "item_hp_change_incoming_physical", passive)
		curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
		curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
		curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = targetMaxHP
		curve.ResolvedSnapshot.TargetSnapshot.MaxHP = targetMaxHP
		curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
		curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0
		return runSingleAttackerDPSForTest(t, input).CurveResults[0]
	}

	t.Run("target max hp below threshold", func(t *testing.T) {
		result := setup(t, 1000)
		if result.Status != "ok" {
			t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
		}
		if len(result.DamageTimeline) != 1 {
			t.Fatalf("damageTimeline = %+v, want one basic attack damage event", result.DamageTimeline)
		}
		basicAttack := result.DamageTimeline[0]
		if !almostEqual(basicAttack.RawDamage, 100) || !almostEqual(basicAttack.FinalDamage, 100) || !almostEqual(result.TotalDamage, 100) {
			t.Fatalf("damage = raw %.4f final %.4f total %.4f, want 100 when max_hp condition fails",
				basicAttack.RawDamage, basicAttack.FinalDamage, result.TotalDamage)
		}
		for _, trigger := range result.ItemPassiveTriggers {
			if trigger.TriggerID == "hp_change_incoming_physical" {
				t.Fatalf("itemPassiveTriggers = %v, want no hp_change trigger when condition fails", result.ItemPassiveTriggers)
			}
		}
		bucketEvidence := findCoefficientBucketEffectBreakdown(result, "bucketKey=incoming_physical_reduction aggregationMode=add valueUnit=percent_delta raw=100 result=100")
		if bucketEvidence == nil {
			t.Fatalf("effectBreakdown = %+v, want skipped-only coefficient_bucket evidence", result.EffectBreakdown)
		}
		cb := bucketEvidence.CoefficientBucket
		if len(cb.Candidates) != 0 || len(cb.Skipped) == 0 {
			t.Fatalf("coefficientBucket = %+v, want empty candidates and skipped entries", cb)
		}
		skipped := cb.Skipped[0]
		if skipped.Applied || skipped.SkipReason == "" || skipped.SkipReason != "condition_not_met:max_hp" {
			t.Fatalf("coefficientBucket.skipped[0] = %+v, want applied=false with max_hp skip reason", skipped)
		}
	})

	t.Run("target max hp meets threshold", func(t *testing.T) {
		result := setup(t, 2000)
		if result.Status != "ok" {
			t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
		}
		if len(result.DamageTimeline) != 1 {
			t.Fatalf("damageTimeline = %+v, want one basic attack damage event", result.DamageTimeline)
		}
		basicAttack := result.DamageTimeline[0]
		if !almostEqual(basicAttack.RawDamage, 80) || !almostEqual(basicAttack.FinalDamage, 80) || !almostEqual(result.TotalDamage, 80) {
			t.Fatalf("damage = raw %.4f final %.4f total %.4f, want 80 when max_hp condition passes",
				basicAttack.RawDamage, basicAttack.FinalDamage, result.TotalDamage)
		}
		if len(result.ItemPassiveTriggers) != 1 || result.ItemPassiveTriggers[0].TriggerID != "hp_change_incoming_physical" {
			t.Fatalf("itemPassiveTriggers = %v, want one hp_change incoming physical trigger", result.ItemPassiveTriggers)
		}
	})
}

func TestSingleAttackerDPSHPChangeConditionMissingHPPctGatesCandidate(t *testing.T) {
	condition := model.DPSModifierConditionV2{
		Metric:      "missing_hp_pct",
		SubjectRole: "target",
		Operator:    "gte",
		Value:       0.5,
	}
	passive := syntheticHPChangeIncomingPhysicalBucketPassive(-0.2)
	passive.Operations[0].Conditions = []model.DPSModifierConditionV2{condition}

	setup := func(t *testing.T, targetCurrentHP float64) model.DPSCurveResultV2 {
		t.Helper()
		input := baseSingleAttackerDPSInput()
		input.SimulationRules.DurationMs = 1
		curve := &input.Curves[0]
		enableTargetDPSPassivesForTest(curve, "item_hp_change_incoming_physical", passive)
		curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
		curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
		curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = targetCurrentHP
		curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
		curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
		curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0
		return runSingleAttackerDPSForTest(t, input).CurveResults[0]
	}

	t.Run("missing hp pct meets threshold", func(t *testing.T) {
		result := setup(t, 500)
		if result.Status != "ok" {
			t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
		}
		basicAttack := result.DamageTimeline[0]
		if !almostEqual(basicAttack.RawDamage, 80) || !almostEqual(basicAttack.FinalDamage, 80) || !almostEqual(result.TotalDamage, 80) {
			t.Fatalf("damage = raw %.4f final %.4f total %.4f, want 80 when missing_hp_pct condition passes",
				basicAttack.RawDamage, basicAttack.FinalDamage, result.TotalDamage)
		}
	})

	t.Run("missing hp pct below threshold", func(t *testing.T) {
		result := setup(t, 900)
		if result.Status != "ok" {
			t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
		}
		basicAttack := result.DamageTimeline[0]
		if !almostEqual(basicAttack.RawDamage, 100) || !almostEqual(basicAttack.FinalDamage, 100) || !almostEqual(result.TotalDamage, 100) {
			t.Fatalf("damage = raw %.4f final %.4f total %.4f, want 100 when missing_hp_pct condition fails",
				basicAttack.RawDamage, basicAttack.FinalDamage, result.TotalDamage)
		}
		for _, trigger := range result.ItemPassiveTriggers {
			if trigger.TriggerID == "hp_change_incoming_physical" {
				t.Fatalf("itemPassiveTriggers = %v, want no hp_change trigger when condition fails", result.ItemPassiveTriggers)
			}
		}
		bucketEvidence := findCoefficientBucketEffectBreakdown(result, "bucketKey=incoming_physical_reduction aggregationMode=add valueUnit=percent_delta raw=100 result=100")
		if bucketEvidence == nil {
			t.Fatalf("effectBreakdown = %+v, want skipped-only coefficient_bucket evidence", result.EffectBreakdown)
		}
		cb := bucketEvidence.CoefficientBucket
		if len(cb.Candidates) != 0 || len(cb.Skipped) == 0 {
			t.Fatalf("coefficientBucket = %+v, want empty candidates and skipped entries", cb)
		}
		skipped := cb.Skipped[0]
		if skipped.Applied || skipped.SkipReason == "" || skipped.SkipReason != "condition_not_met:missing_hp_pct" {
			t.Fatalf("coefficientBucket.skipped[0] = %+v, want applied=false with missing_hp_pct skip reason", skipped)
		}
	})
}

func TestSingleAttackerDPSHPChangeHPDiffRatioValueSpec(t *testing.T) {
	passive := syntheticHPChangeIncomingPhysicalBucketPassive(0)
	passive.Operations[0].ValueSpec = model.DPSModifierValueSpecV2{
		Kind:        "hp_diff_ratio",
		OwnerRole:   "attacker",
		CompareRole: "target",
		Ratio:       0.0001,
	}

	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	enableTargetDPSPassivesForTest(curve, "item_hp_change_incoming_physical", passive)
	curve.ResolvedSnapshot.AttackerSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.AttackerSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 2000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 2000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.DamageTimeline) != 1 {
		t.Fatalf("damageTimeline = %+v, want one basic attack damage event", result.DamageTimeline)
	}
	basicAttack := result.DamageTimeline[0]
	if !almostEqual(basicAttack.RawDamage, 110) || !almostEqual(basicAttack.FinalDamage, 110) || !almostEqual(result.TotalDamage, 110) {
		t.Fatalf("damage = raw %.4f final %.4f total %.4f, want 110 from hp_diff_ratio percent_delta 0.1",
			basicAttack.RawDamage, basicAttack.FinalDamage, result.TotalDamage)
	}
	if !effectBreakdownMessageContains(result, dpsEffectCoefficientBucket, "domain=hp_change stageKey="+dpsHPChangeStageIncomingPreMitigation+" bucketKey=incoming_physical_reduction aggregationMode=add valueUnit=percent_delta raw=100 result=110") {
		t.Fatalf("effectBreakdown = %+v, want hp_diff_ratio coefficient_bucket evidence", result.EffectBreakdown)
	}
}

func TestSingleAttackerDPSHPChangeCritConditionRequiresCritContext(t *testing.T) {
	bundle := compileDPSTestBundlePatched(t, func(bundle *model.EngineBundle) {
		for i, action := range bundle.Actions {
			if action.ID != dpsTestDefaultBasicAttackActionID {
				continue
			}
			for j := range action.Effects {
				bundle.Actions[i].Effects[j].CritPolicy = ""
			}
		}
	})
	passive := syntheticHPChangeIncomingPhysicalBucketPassive(-0.2)
	passive.Operations[0].Conditions = []model.DPSModifierConditionV2{{
		Metric:    "crit",
		Operator:  "eq",
		TextValue: "true",
	}}

	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	enableTargetDPSPassivesForTest(curve, "item_hp_change_incoming_physical", passive)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSWithBundle(t, bundle, input).CurveResults[0]
	if result.Status != "blocked" {
		t.Fatalf("status = %s, want blocked when crit condition lacks crit context", result.Status)
	}
	if !blockedReasonContains(result, "crit condition requires crit context") {
		t.Fatalf("blockedReasons = %v, want crit condition crit context block", result.BlockedReasons)
	}
}

func TestSingleAttackerDPSIncomingCritOnlyModifierRequiresCritContext(t *testing.T) {
	bundle := compileDPSTestBundlePatched(t, func(bundle *model.EngineBundle) {
		for i, action := range bundle.Actions {
			if action.ID != dpsTestDefaultBasicAttackActionID {
				continue
			}
			for j := range action.Effects {
				bundle.Actions[i].Effects[j].CritPolicy = ""
			}
		}
	})
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, syntheticCritOnlyIncomingDamageModifierPassive())
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSWithBundle(t, bundle, input).CurveResults[0]
	if result.Status != "blocked" {
		t.Fatalf("status = %s, want blocked when critOnly lacks crit context", result.Status)
	}
	if !blockedReasonContains(result, "critOnly requires crit context") {
		t.Fatalf("blockedReasons = %v, want critOnly crit context block", result.BlockedReasons)
	}
}

func TestSingleAttackerDPSExpectedCritOnlyModifierAppliesToCritPortion(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	enableTargetDPSPassivesForTest(curve, "item_crit_only_incoming_reduction", syntheticCritOnlyIncomingDamageModifierPassive())
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["crit_chance"] = 0.5
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["crit_damage"] = 2
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.DamageTimeline) != 1 || !almostEqual(result.DamageTimeline[0].FinalDamage, 130) {
		t.Fatalf("damageTimeline = %+v, want final expected damage 130", result.DamageTimeline)
	}
	critCtx := result.DamageTimeline[0].CritContext
	if critCtx == nil || !almostEqual(critCtx.ExpectedNormalPart, 50) || !almostEqual(critCtx.ExpectedCritPart, 80) {
		t.Fatalf("critContext = %+v, want expectedNormalPart=50 expectedCritPart=80", critCtx)
	}
	modifierAmount := effectBreakdownAmountBySource(result, dpsOpDamageModifier, "crit_only_incoming_reduction")
	if !almostEqual(modifierAmount, -20) {
		t.Fatalf("critOnly modifier amount = %.4f, want -20 total delta", modifierAmount)
	}
}

func TestSingleAttackerDPSOnCritExpectedZeroChancePureDamage(t *testing.T) {
	passive := model.DPSPassiveEffectV2{
		PassiveID:      "champion_zero_chance_on_crit_test",
		SourceCategory: "skill_passive",
		SourceID:       "zero_chance_passive",
		SourceType:     "skill",
		TriggerID:      "zero_chance_on_crit_magic",
		Trigger: model.DPSPassiveTriggerSpecV2{
			Event: dpsEventOnCrit,
		},
		Operations: []model.DPSPassiveOperationV2{{
			Kind:       dpsOpDamage,
			Source:     "zero_chance_on_crit_magic",
			DamageType: "magic",
			Amount:     20,
		}},
	}

	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, passive)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["crit_chance"] = 0
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["crit_damage"] = 2
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if result.DamageBySource["zero_chance_on_crit_magic"] != 0 {
		t.Fatalf("damageBySource = %v, want no onCrit damage at zero chance", result.DamageBySource)
	}
	for _, trigger := range result.SkillPassiveTriggers {
		if trigger.TriggerID == "zero_chance_on_crit_magic" {
			t.Fatalf("skillPassiveTriggers = %v, want no onCrit trigger at zero chance", result.SkillPassiveTriggers)
		}
	}
}

func TestSingleAttackerDPSOnCritExpectedZeroChanceStatefulDoesNotBlock(t *testing.T) {
	passive := model.DPSPassiveEffectV2{
		PassiveID:      "champion_zero_chance_stateful_on_crit_test",
		SourceCategory: "skill_passive",
		SourceID:       "zero_chance_stateful_on_crit",
		SourceType:     "skill",
		TriggerID:      "zero_chance_stateful_on_crit_stack",
		Trigger: model.DPSPassiveTriggerSpecV2{
			Event: dpsEventOnCrit,
		},
		Operations: []model.DPSPassiveOperationV2{{
			Kind:      dpsOpAddStack,
			Source:    "zero_chance_stateful_on_crit_stack",
			StackKey:  "on_crit_stack",
			MaxStacks: 3,
		}},
	}

	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, passive)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["crit_chance"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok without stateful onCrit block", result.Status, result.BlockedReasons)
	}
	for _, trigger := range result.SkillPassiveTriggers {
		if trigger.TriggerID == "zero_chance_stateful_on_crit_stack" {
			t.Fatalf("skillPassiveTriggers = %v, want no onCrit trigger at zero chance", result.SkillPassiveTriggers)
		}
	}
}

func TestSingleAttackerDPSTargetCritOnlyModifierAffectsCritPortionOnly(t *testing.T) {
	passive := syntheticCritOnlyIncomingDamageModifierPassive()
	passive.Operations[0].Value = -0.3

	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	enableTargetDPSPassivesForTest(curve, "item_randuin_crit_only", passive)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["crit_chance"] = 0.5
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["crit_damage"] = 2
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.DamageTimeline) != 1 || !almostEqual(result.DamageTimeline[0].FinalDamage, 120) {
		t.Fatalf("damageTimeline = %+v, want final damage 120 from crit-only -30%% on crit portion", result.DamageTimeline)
	}
}

func sunderedSkyCritContextModifierPassive() model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:      "item_sundered_sky_crit_scale_test",
		SourceCategory: "item_passive",
		SourceID:       "item_sundered_sky",
		SourceType:     "item",
		TriggerID:      "sundered_sky_first_attack_crit",
		TriggerKind:    dpsTriggerPreEnabledModifier,
		Operations: []model.DPSPassiveOperationV2{{
			Kind:                   dpsOpCritContextModifier,
			Source:                 "sundered_sky_first_attack_crit",
			ForceCrit:              true,
			HasCritMultiplierScale: true,
			CritMultiplierScale:    0.8,
		}},
	}
}

func runSunderedSkyTrainingFieldDPSForTest(
	t *testing.T,
	ad float64,
	critChance float64,
	critDamage float64,
	armor float64,
	targetHP float64,
	passives ...model.DPSPassiveEffectV2,
) model.DPSCurveResultV2 {
	t.Helper()
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	if len(passives) > 0 {
		enableDPSPassivesForTest(curve, passives...)
	}
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = ad
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["crit_chance"] = critChance
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["crit_damage"] = critDamage
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = targetHP
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = targetHP
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = armor
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0
	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.DamageTimeline) != 1 {
		t.Fatalf("damageTimeline length = %d, want 1", len(result.DamageTimeline))
	}
	return result
}

func runRanduinTargetCritOnlyDPSForTest(
	t *testing.T,
	ad float64,
	critChance float64,
	critDamage float64,
	armor float64,
	targetHP float64,
	attackerPassives []model.DPSPassiveEffectV2,
) model.DPSCurveResultV2 {
	t.Helper()
	randuinPassive := syntheticCritOnlyIncomingDamageModifierPassive()
	randuinPassive.Operations[0].Value = -0.3

	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	enableMixedDPSPassivesForTest(curve, "item_randuin_crit_only", attackerPassives, []model.DPSPassiveEffectV2{randuinPassive})
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = ad
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["crit_chance"] = critChance
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["crit_damage"] = critDamage
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = targetHP
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = targetHP
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = armor
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0
	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.DamageTimeline) != 1 {
		t.Fatalf("damageTimeline length = %d, want 1", len(result.DamageTimeline))
	}
	return result
}

func TestSingleAttackerDPSSunderedSkyCritMultiplierScaleEzrealTrainingData(t *testing.T) {
	sunderedPassive := sunderedSkyCritContextModifierPassive()

	t.Run("AD105_no_infinity_edge_armor0", func(t *testing.T) {
		result := runSunderedSkyTrainingFieldDPSForTest(t, 105, 0, 2, 0, 1000, sunderedPassive)
		if !almostEqual(result.DamageTimeline[0].FinalDamage, 168) {
			t.Fatalf("finalDamage = %.4f, want 168 (105 * 2.0 * 0.8)", result.DamageTimeline[0].FinalDamage)
		}
	})

	t.Run("AD180_no_infinity_edge_armor0", func(t *testing.T) {
		result := runSunderedSkyTrainingFieldDPSForTest(t, 180, 0, 2, 0, 1000, sunderedPassive)
		if !almostEqual(result.DamageTimeline[0].FinalDamage, 288) {
			t.Fatalf("finalDamage = %.4f, want 288 (180 * 2.0 * 0.8)", result.DamageTimeline[0].FinalDamage)
		}
	})

	t.Run("AD180_infinity_edge_armor0", func(t *testing.T) {
		result := runSunderedSkyTrainingFieldDPSForTest(t, 180, 0, 2.3, 0, 1000, sunderedPassive)
		if !almostEqual(result.DamageTimeline[0].FinalDamage, 331.2) {
			t.Fatalf("finalDamage = %.4f, want 331.2 (180 * 2.3 * 0.8)", result.DamageTimeline[0].FinalDamage)
		}
		if !effectBreakdownMessageContains(result, dpsOpCritContextModifier, "multiplierScale=0.8") {
			t.Fatalf("effectBreakdown = %+v, want multiplierScale evidence", result.EffectBreakdown)
		}
		if !effectBreakdownResolvedMultiplierAlmostEqual(result, dpsOpCritContextModifier, 1.84) {
			t.Fatalf("effectBreakdown = %+v, want resolvedMultiplier≈1.84 evidence", result.EffectBreakdown)
		}
	})

	t.Run("AD180_infinity_edge_full_crit_armor0", func(t *testing.T) {
		result := runSunderedSkyTrainingFieldDPSForTest(t, 180, 1, 2.3, 0, 1000)
		if !almostEqual(result.DamageTimeline[0].FinalDamage, 414) {
			t.Fatalf("finalDamage = %.4f, want 414 (180 * 2.3)", result.DamageTimeline[0].FinalDamage)
		}
	})

	t.Run("randuin_sundered_infinity_edge_armor75", func(t *testing.T) {
		result := runRanduinTargetCritOnlyDPSForTest(t, 180, 0, 2.3, 75, 1750, []model.DPSPassiveEffectV2{sunderedPassive})
		if !almostEqual(result.DamageTimeline[0].FinalDamage, 132.48) {
			t.Fatalf("finalDamage = %.4f, want 132.48", result.DamageTimeline[0].FinalDamage)
		}
	})

	t.Run("randuin_infinity_edge_full_crit_armor75", func(t *testing.T) {
		result := runRanduinTargetCritOnlyDPSForTest(t, 180, 1, 2.3, 75, 1750, nil)
		if !almostEqual(result.DamageTimeline[0].FinalDamage, 165.6) {
			t.Fatalf("finalDamage = %.4f, want 165.6", result.DamageTimeline[0].FinalDamage)
		}
	})

	t.Run("randuin_non_crit_armor75", func(t *testing.T) {
		result := runRanduinTargetCritOnlyDPSForTest(t, 180, 0, 2.3, 75, 1750, nil)
		want := 180.0 * 100.0 / (100.0 + 75.0)
		if !almostEqual(result.DamageTimeline[0].FinalDamage, want) {
			t.Fatalf("finalDamage = %.6f, want %.6f (critOnly must not affect non-crit)", result.DamageTimeline[0].FinalDamage, want)
		}
	})
}

func TestSingleAttackerDPSForceCritContextModifier(t *testing.T) {
	passive := model.DPSPassiveEffectV2{
		PassiveID:      "item_fentian_force_crit_test",
		SourceCategory: "item_passive",
		SourceID:       "item_fentian",
		SourceType:     "item",
		TriggerID:      "fentian_force_crit",
		TriggerKind:    dpsTriggerPreEnabledModifier,
		Operations: []model.DPSPassiveOperationV2{{
			Kind:                      dpsOpCritContextModifier,
			Source:                    "fentian_force_crit",
			ForceCrit:                 true,
			HasCritMultiplierOverride: true,
			CritMultiplierOverride:    2,
		}},
	}

	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, passive)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.DamageTimeline) != 1 || !almostEqual(result.DamageTimeline[0].FinalDamage, 200) {
		t.Fatalf("damageTimeline = %+v, want forceCrit final damage 200", result.DamageTimeline)
	}
	if !effectBreakdownMessageContains(result, dpsOpCritContextModifier, "forceCrit=true") {
		t.Fatalf("effectBreakdown = %+v, want forceCrit evidence", result.EffectBreakdown)
	}
}

func TestSingleAttackerDPSNextAttackCritContextModifierDoesNotApplyToSkillDamage(t *testing.T) {
	stateID := "next_attack_force_crit_ready"
	scenario := spellbladeScenarioState(stateID, 0, 8000)
	passive := model.DPSPassiveEffectV2{
		PassiveID:               "item_next_attack_force_crit_test",
		SourceCategory:          "item_passive",
		SourceID:                "item_next_attack_force_crit",
		SourceType:              "item",
		TriggerID:               "next_attack_force_crit",
		TriggerKind:             dpsTriggerNextBasicAttackAfterState,
		RequiresScenarioStateID: stateID,
		Operations: []model.DPSPassiveOperationV2{{
			Kind:      dpsOpCritContextModifier,
			Source:    "next_attack_force_crit",
			ForceCrit: true,
		}},
	}

	bundle := compileDPSTestBundlePatched(t, func(bundle *model.EngineBundle) {
		for i, action := range bundle.Actions {
			if action.ID != dpsTestCooldownSkillActionID {
				continue
			}
			for j := range action.Effects {
				bundle.Actions[i].Effects[j].CritPolicy = "expected"
				bundle.Actions[i].Effects[j].CritChanceSource = "attacker_crit_chance"
				bundle.Actions[i].Effects[j].CritMultiplierSource = "attacker_crit_damage"
			}
		}
	})

	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	skillOnlyDPSCurveSetup(curve)
	enableDPSPassivesForTest(curve, passive)
	curve.Selection.ScenarioStates = []model.DPSScenarioStateV2{scenario}
	curve.ResolvedSnapshot.ScenarioStates = []model.DPSScenarioStateV2{scenario}
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ap"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["crit_chance"] = 0.5
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["crit_damage"] = 2
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSWithBundle(t, bundle, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if !almostEqual(result.DamageBySource[dpsTestCooldownSkillSkillID], 150) {
		t.Fatalf("damageBySource = %v, want expected crit skill damage 150 without next-attack forceCrit", result.DamageBySource)
	}
	if effectBreakdownMessageContains(result, dpsOpCritContextModifier, "forceCrit=true") {
		t.Fatalf("effectBreakdown = %+v, want no next-attack forceCrit on skill damage", result.EffectBreakdown)
	}
}

func TestSingleAttackerDPSOnCritExpectedPureDamage(t *testing.T) {
	passive := model.DPSPassiveEffectV2{
		PassiveID:      "champion_yunara_on_crit_test",
		SourceCategory: "skill_passive",
		SourceID:       "yunara_passive",
		SourceType:     "skill",
		TriggerID:      "yunara_on_crit_magic",
		Trigger: model.DPSPassiveTriggerSpecV2{
			Event: dpsEventOnCrit,
		},
		Operations: []model.DPSPassiveOperationV2{{
			Kind:       dpsOpDamage,
			Source:     "yunara_on_crit_magic",
			DamageType: "magic",
			Amount:     20,
		}},
	}

	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, passive)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["crit_chance"] = 0.5
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["crit_damage"] = 2
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if !almostEqual(result.DamageBySource["yunara_on_crit_magic"], 10) {
		t.Fatalf("damageBySource = %v, want onCrit expected magic damage 10", result.DamageBySource)
	}
}

func TestSingleAttackerDPSStatefulOnCritBlocksUnderExpectedPolicy(t *testing.T) {
	passive := model.DPSPassiveEffectV2{
		PassiveID:      "champion_stateful_on_crit_test",
		SourceCategory: "skill_passive",
		SourceID:       "stateful_on_crit",
		SourceType:     "skill",
		TriggerID:      "stateful_on_crit_stack",
		Trigger: model.DPSPassiveTriggerSpecV2{
			Event: dpsEventOnCrit,
		},
		Operations: []model.DPSPassiveOperationV2{{
			Kind:      dpsOpAddStack,
			Source:    "stateful_on_crit_stack",
			StackKey:  "on_crit_stack",
			MaxStacks: 3,
		}},
	}

	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, passive)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["crit_chance"] = 0.5
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "blocked" {
		t.Fatalf("status = %s, want blocked for stateful onCrit under expected policy", result.Status)
	}
	if !blockedReasonContains(result, "on_crit stateful operation requires actual or seeded crit result") {
		t.Fatalf("blockedReasons = %v, want stateful onCrit block reason", result.BlockedReasons)
	}
}

func TestSingleAttackerDPSCritScalingValueSpecUsesBoundedChance(t *testing.T) {
	bundle := compileDPSTestBundlePatched(t, func(bundle *model.EngineBundle) {
		for i, attr := range bundle.Attributes {
			if attr.ID != "crit_chance" {
				continue
			}
			bundle.Attributes[i].HasClampMin = true
			bundle.Attributes[i].ClampMin = 0
			bundle.Attributes[i].HasClampMax = true
			bundle.Attributes[i].ClampMax = 1
		}
	})
	passive := model.DPSPassiveEffectV2{
		PassiveID:      "item_navori_crit_scaling_test",
		SourceCategory: "item_passive",
		SourceID:       "item_navori",
		SourceType:     "item",
		TriggerID:      "navori_outgoing_crit_scaling",
		OwnerRole:      "attacker",
		Trigger: model.DPSPassiveTriggerSpecV2{
			Event: dpsEventOnDamageDealt,
			Matcher: model.DPSPassiveTriggerMatcherV2{
				DamageTypes: []string{"physical"},
			},
		},
		Operations: []model.DPSPassiveOperationV2{{
			Kind:         dpsOpDamageModifier,
			Source:       "navori_outgoing_crit_scaling",
			TargetRole:   "attacker",
			BucketKey:    "outgoing_add_priority_late",
			ModifierMode: "percent",
			ValueSpec: model.DPSModifierValueSpecV2{
				Kind:    "crit_scaling",
				AttrKey: "crit_chance_effective",
				Ratio:   0.1,
			},
		}},
	}

	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, passive)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["crit_chance"] = 1.25
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["crit_damage"] = 2
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSWithBundle(t, bundle, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.DamageTimeline) != 1 || !almostEqual(result.DamageTimeline[0].FinalDamage, 220) {
		t.Fatalf("damageTimeline = %+v, want final damage 220 from bounded crit chance 1 scaling + expected crit", result.DamageTimeline)
	}
}

func TestSingleAttackerDPSLinkedEffectCanDispatchSyntheticSpellHit(t *testing.T) {
	result := dispatchSyntheticSpellHitForTest(t, syntheticLudenSpellHitPassive())
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.ItemPassiveTriggers) != 1 {
		t.Fatalf("itemPassiveTriggers = %v, want one spell-hit trigger", result.ItemPassiveTriggers)
	}
	if !almostEqual(result.DamageBySource["luden_spell_hit_proc"], 40) {
		t.Fatalf("damageBySource = %v, want luden spell-hit proc damage", result.DamageBySource)
	}
	if len(result.DamageTimeline) != 1 || !almostEqual(result.DamageTimeline[0].FinalDamage, 40) {
		t.Fatalf("damageTimeline = %+v, want synthetic spell-hit proc damage", result.DamageTimeline)
	}
}

func TestSingleAttackerDPSPhantomHitDoesNotCopySpellProc(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 2000
	curve := &input.Curves[0]
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 2
	enableDPSPassivesForTest(curve, testPhantomHitPassive(), syntheticLudenSpellHitPassive())
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	fourthHitMs := result.AttackTimeline[3].TimeMs
	if damageCountBySourceAt(result, "luden_spell_hit_proc", fourthHitMs) != 0 {
		t.Fatalf("damageTimeline = %+v, want no spell proc copied on phantom hit", result.DamageTimeline)
	}
	if result.DamageBySource["luden_spell_hit_proc"] != 0 {
		t.Fatalf("damageBySource = %v, want no spell proc during basic attack simulation", result.DamageBySource)
	}
	phantomSources := make([]string, 0)
	for _, event := range result.DamageTimeline {
		if event.PhantomHit && event.TimeMs == fourthHitMs {
			phantomSources = append(phantomSources, event.Source)
		}
	}
	if !sameStrings(phantomSources, []string{"test_copyable_on_hit"}) {
		t.Fatalf("phantom damage sources = %v, want only copyable basic on-hit damage", phantomSources)
	}
	for _, trigger := range result.ItemPassiveTriggers {
		if trigger.TriggerID == "luden_spell_hit" {
			t.Fatalf("itemPassiveTriggers = %v, want no spell-hit trigger from basic attack or phantom hit", result.ItemPassiveTriggers)
		}
	}
}

func syntheticRabadonAPFinalMultiplierPassive() model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:      "item_rabadons_deathcap_ap_multiplier",
		SourceCategory: "item_passive",
		SourceID:       "item_rabadons_deathcap",
		SourceType:     "item",
		TriggerID:      "rabadon_ap_final_multiplier",
		TriggerKind:    dpsTriggerStatAlwaysOn,
		Operations: []model.DPSPassiveOperationV2{{
			Kind:      dpsOpStatModifier,
			Source:    "rabadon_ap_final_multiplier",
			AttrKey:   "ap",
			BucketKey: "ap_final_multiplier",
			Value:     0.3,
		}},
	}
}

func syntheticGoliathAugmentAttributePassives() []model.DPSPassiveEffectV2 {
	return []model.DPSPassiveEffectV2{
		{
			PassiveID:      "augment_goliath_hp_bonus",
			SourceCategory: "external_passive",
			SourceID:       "augment_goliath_giant",
			SourceType:     "augment",
			TriggerID:      "goliath_hp_flat_bonus",
			TriggerKind:    dpsTriggerStatAlwaysOn,
			Operations: []model.DPSPassiveOperationV2{{
				Kind:      dpsOpStatModifier,
				Source:    "goliath_hp_flat_bonus",
				AttrKey:   "hp",
				BucketKey: "hp_flat_bonus",
				Value:     800,
			}},
		},
		{
			PassiveID:      "augment_goliath_adaptive_force",
			SourceCategory: "external_passive",
			SourceID:       "augment_goliath_giant",
			SourceType:     "augment",
			TriggerID:      "goliath_adaptive_force_flat_bonus",
			TriggerKind:    dpsTriggerStatAlwaysOn,
			Operations: []model.DPSPassiveOperationV2{{
				Kind:      dpsOpStatModifier,
				Source:    "goliath_adaptive_force_flat_bonus",
				AttrKey:   "adaptive_force",
				BucketKey: "adaptive_force_flat_bonus",
				Value:     25,
			}},
		},
	}
}

func syntheticWarmogAttributePassive() model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:      "item_warmogs_armor_hp_regen",
		SourceCategory: "item_passive",
		SourceID:       "item_warmogs_armor",
		SourceType:     "item",
		TriggerID:      "warmog_hp_regen_bonus",
		TriggerKind:    dpsTriggerStatAlwaysOn,
		Operations: []model.DPSPassiveOperationV2{
			{
				Kind:      dpsOpStatModifier,
				Source:    "warmog_hp_flat_bonus",
				AttrKey:   "hp",
				BucketKey: "hp_flat_bonus",
				Value:     500,
			},
			{
				Kind:      dpsOpStatModifier,
				Source:    "warmog_health_regen_flat_bonus",
				AttrKey:   "health_regen",
				BucketKey: "health_regen_flat_bonus",
				Value:     12,
			},
		},
	}
}

func syntheticTargetArmorFlatBonusPassive(flatDelta float64) model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:      "item_target_armor_shred_test",
		SourceCategory: "item_passive",
		SourceID:       "item_target_armor_shred",
		SourceType:     "item",
		OwnerRole:      "target",
		TriggerID:      "target_armor_flat_bonus",
		TriggerKind:    dpsTriggerStatAlwaysOn,
		Operations: []model.DPSPassiveOperationV2{{
			Kind:       dpsOpStatModifier,
			Source:     "target_armor_flat_bonus",
			AttrKey:    "armor",
			TargetRole: "target",
			BucketKey:  "target_armor_flat_bonus",
			Value:      flatDelta,
		}},
	}
}

func skillOnlyDPSCurveSetup(curve *model.DPSCurveRunSpecV2) {
	curve.ResolvedSnapshot.BasicAttackActions = nil
	curve.ResolvedSnapshot.ActiveActions = []model.DPSActiveActionRefV2{{
		ActionID:   dpsTestCooldownSkillActionID,
		SkillID:    dpsTestCooldownSkillSkillID,
		Kind:       dpsActiveActionKindSkill,
		Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}, Tags: []string{"skill_tag/spell_damage"}},
	}}
}

func TestSingleAttackerDPSRabadonAPFinalMultiplierFeedsSkillDamage(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	skillOnlyDPSCurveSetup(curve)
	enableDPSPassivesForTest(curve, syntheticRabadonAPFinalMultiplierPassive())
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ap"] = 300
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if got := result.ResolvedSnapshot.AttackerSnapshot.Attributes["ap"]; !almostEqual(got, 390) {
		t.Fatalf("resolved ap = %.4f, want 390 after +30%% final multiplier bucket", got)
	}
	if !almostEqual(result.DamageBySource[dpsTestCooldownSkillSkillID], 390) {
		t.Fatalf("damageBySource = %v, want skill damage 390 from resolved ap", result.DamageBySource)
	}
	if !effectBreakdownMessageContains(result, dpsEffectCoefficientBucket, "domain=attribute stageKey="+dpsAttributeStageFinalMultiplier+" bucketKey=ap_final_multiplier aggregationMode=add valueUnit=percent_delta raw=300 result=390") {
		t.Fatalf("effectBreakdown = %+v, want ap_final_multiplier coefficient_bucket evidence", result.EffectBreakdown)
	}
	bucketEvidence := findCoefficientBucketEffectBreakdown(result, "bucketKey=ap_final_multiplier aggregationMode=add valueUnit=percent_delta raw=300 result=390")
	if bucketEvidence == nil {
		t.Fatalf("effectBreakdown = %+v, want structured coefficient_bucket evidence", result.EffectBreakdown)
	}
	cb := bucketEvidence.CoefficientBucket
	if cb.Domain != "attribute" || cb.BucketKey != "ap_final_multiplier" || !almostEqual(cb.Raw, 300) || !almostEqual(cb.Result, 390) {
		t.Fatalf("coefficientBucket = %+v, want attribute ap_final_multiplier raw=300 result=390", cb)
	}
	if len(cb.Candidates) == 0 {
		t.Fatalf("coefficientBucket.candidates = %+v, want non-empty applied candidates", cb.Candidates)
	}
}

func TestSingleAttackerDPSGoliathAugmentAttributeBucketsResolve(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, syntheticGoliathAugmentAttributePassives()...)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["hp"] = 550
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["adaptive_force"] = 0
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if got := result.ResolvedSnapshot.AttackerSnapshot.Attributes["hp"]; !almostEqual(got, 1350) {
		t.Fatalf("resolved hp = %.4f, want 1350 after +800 flat bucket", got)
	}
	if got := result.ResolvedSnapshot.AttackerSnapshot.Attributes["adaptive_force"]; !almostEqual(got, 25) {
		t.Fatalf("resolved adaptive_force = %.4f, want 25 after +25 flat bucket", got)
	}
	if len(result.ExternalPassiveTriggers) != 2 {
		t.Fatalf("externalPassiveTriggers = %+v, want two augment triggers", result.ExternalPassiveTriggers)
	}
	for _, trigger := range result.ExternalPassiveTriggers {
		if trigger.SourceType != "augment" {
			t.Fatalf("trigger = %+v, want sourceType augment in evidence", trigger)
		}
	}
	if !effectBreakdownMessageContains(result, dpsEffectCoefficientBucket, "domain=attribute stageKey="+dpsAttributeStageFlatBonus+" bucketKey=hp_flat_bonus") {
		t.Fatalf("effectBreakdown = %+v, want hp_flat_bonus coefficient_bucket evidence", result.EffectBreakdown)
	}
	if !effectBreakdownMessageContains(result, dpsEffectCoefficientBucket, "bucketKey=adaptive_force_flat_bonus") ||
		!effectBreakdownMessageContains(result, dpsEffectCoefficientBucket, "bucketKey=adaptive_force_flat_bonus aggregationMode=add valueUnit=flat_delta raw=0 result=25") {
		t.Fatalf("effectBreakdown = %+v, want adaptive_force_flat_bonus coefficient_bucket evidence", result.EffectBreakdown)
	}
}

func TestSingleAttackerDPSWarmogLikeHPAndRegenAttributeBucketsResolve(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, syntheticWarmogAttributePassive())
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["hp"] = 1000
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["health_regen"] = 5
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if got := result.ResolvedSnapshot.AttackerSnapshot.Attributes["hp"]; !almostEqual(got, 1500) {
		t.Fatalf("resolved hp = %.4f, want 1500 after +500 flat bucket", got)
	}
	if got := result.ResolvedSnapshot.AttackerSnapshot.Attributes["health_regen"]; !almostEqual(got, 17) {
		t.Fatalf("resolved health_regen = %.4f, want 17 after +12 flat bucket", got)
	}
	if !effectBreakdownMessageContains(result, dpsEffectCoefficientBucket, "bucketKey=health_regen_flat_bonus aggregationMode=add valueUnit=flat_delta raw=5 result=17") {
		t.Fatalf("effectBreakdown = %+v, want health_regen_flat_bonus coefficient_bucket evidence", result.EffectBreakdown)
	}
}

func TestSingleAttackerDPSLegacyStackingStatModifierUnchangedWithoutBucketKey(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 6000
	curve := &input.Curves[0]
	passive := canonicalStackingStatModifierPassive("legacy_guinsoo_stack", "legacy_guinsoo_stack", 6000, 3, 0.08, 0)
	enableDPSPassivesForTest(curve, passive)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if !effectBreakdownMessageContains(result, dpsOpStatModifier, "perStack=true stackKey=legacy_guinsoo_stack stacks=3") {
		t.Fatalf("effectBreakdown = %+v, want legacy stat_modifier evidence without bucket", result.EffectBreakdown)
	}
	for _, event := range result.EffectBreakdown {
		if event.Kind == dpsEffectCoefficientBucket {
			t.Fatalf("effectBreakdown = %+v, want no coefficient_bucket for legacy stacking stat_modifier", result.EffectBreakdown)
		}
	}
	if got := maxBreakdownAmount(result, dpsOpStatModifier); !almostEqual(got, 1.24) {
		t.Fatalf("max stat_modifier amount = %.4f, want 1.24 attack_speed after 3 stacks * 8%%", got)
	}
}

func TestSingleAttackerDPSTargetArmorAttributeBucketAffectsMitigation(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	enableTargetDPSPassivesForTest(curve, "item_target_armor_shred", syntheticTargetArmorFlatBonusPassive(-50))
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 100
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if got := result.ResolvedSnapshot.TargetSnapshot.Attributes["armor"]; !almostEqual(got, 50) {
		t.Fatalf("resolved target armor = %.4f, want 50 after -50 flat bucket", got)
	}
	if len(result.DamageTimeline) != 1 {
		t.Fatalf("damageTimeline = %+v, want one basic attack", result.DamageTimeline)
	}
	if !almostEqual(result.DamageTimeline[0].FinalDamage, 66.66666666666667) {
		t.Fatalf("final damage = %.4f, want ~66.67 with 50 armor (100 ad)", result.DamageTimeline[0].FinalDamage)
	}
	if !effectBreakdownMessageContains(result, dpsEffectCoefficientBucket, "bucketKey=target_armor_flat_bonus aggregationMode=add valueUnit=flat_delta raw=100 result=50") {
		t.Fatalf("effectBreakdown = %+v, want target_armor_flat_bonus coefficient_bucket evidence", result.EffectBreakdown)
	}
}

func syntheticBucketKeyStatModifiersWithoutAttrKey() []model.DPSPassiveEffectV2 {
	return []model.DPSPassiveEffectV2{
		{
			PassiveID:      "item_rabadon_ap_no_attr_key",
			SourceCategory: "item_passive",
			SourceID:       "item_rabadon_ap_no_attr_key",
			SourceType:     "item",
			TriggerID:      "rabadon_ap_no_attr_key",
			TriggerKind:    dpsTriggerStatAlwaysOn,
			Operations: []model.DPSPassiveOperationV2{{
				Kind:      dpsOpStatModifier,
				Source:    "rabadon_ap_no_attr_key",
				BucketKey: "ap_final_multiplier",
				Value:     0.3,
			}},
		},
		{
			PassiveID:      "augment_hp_no_attr_key",
			SourceCategory: "external_passive",
			SourceID:       "augment_hp_no_attr_key",
			SourceType:     "augment",
			TriggerID:      "hp_no_attr_key",
			TriggerKind:    dpsTriggerStatAlwaysOn,
			Operations: []model.DPSPassiveOperationV2{{
				Kind:      dpsOpStatModifier,
				Source:    "hp_no_attr_key",
				BucketKey: "hp_flat_bonus",
				Value:     200,
			}},
		},
	}
}

func TestSingleAttackerDPSBucketKeyStatModifierWithoutAttrKeyResolvesTargetAttr(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	skillOnlyDPSCurveSetup(curve)
	enableDPSPassivesForTest(curve, syntheticBucketKeyStatModifiersWithoutAttrKey()...)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ap"] = 300
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["hp"] = 1000
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if got := result.ResolvedSnapshot.AttackerSnapshot.Attributes["ap"]; !almostEqual(got, 390) {
		t.Fatalf("resolved ap = %.4f, want 390 from bucket targetAttrKey without op attrKey", got)
	}
	if got := result.ResolvedSnapshot.AttackerSnapshot.Attributes["hp"]; !almostEqual(got, 1200) {
		t.Fatalf("resolved hp = %.4f, want 1200 from bucket targetAttrKey without op attrKey", got)
	}
	if !almostEqual(result.DamageBySource[dpsTestCooldownSkillSkillID], 390) {
		t.Fatalf("damageBySource = %v, want skill damage 390 from resolved ap", result.DamageBySource)
	}
}

func syntheticPickMaxHPFlatBonusPassives() []model.DPSPassiveEffectV2 {
	return []model.DPSPassiveEffectV2{
		{
			PassiveID:      "pick_max_hp_candidate_low",
			SourceCategory: "item_passive",
			SourceID:       "pick_max_hp_candidate_low",
			SourceType:     "item",
			TriggerID:      "pick_max_hp_candidate_low",
			TriggerKind:    dpsTriggerStatAlwaysOn,
			Operations: []model.DPSPassiveOperationV2{{
				Kind:      dpsOpStatModifier,
				Source:    "pick_max_hp_candidate_low",
				BucketKey: "hp_flat_pick_max",
				Value:     10,
			}},
		},
		{
			PassiveID:      "pick_max_hp_candidate_high",
			SourceCategory: "item_passive",
			SourceID:       "pick_max_hp_candidate_high",
			SourceType:     "item",
			TriggerID:      "pick_max_hp_candidate_high",
			TriggerKind:    dpsTriggerStatAlwaysOn,
			Operations: []model.DPSPassiveOperationV2{{
				Kind:      dpsOpStatModifier,
				Source:    "pick_max_hp_candidate_high",
				BucketKey: "hp_flat_pick_max",
				Value:     25,
			}},
		},
	}
}

func TestSingleAttackerDPSAttributePickMaxFlatBucketTakesMaximumCandidate(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, syntheticPickMaxHPFlatBonusPassives()...)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["hp"] = 1000
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if got := result.ResolvedSnapshot.AttackerSnapshot.Attributes["hp"]; !almostEqual(got, 1025) {
		t.Fatalf("resolved hp = %.4f, want 1025 after pick_max flat_delta +25 over +10", got)
	}
	if !effectBreakdownMessageContains(result, dpsEffectCoefficientBucket, "bucketKey=hp_flat_pick_max aggregationMode=pick_max valueUnit=flat_delta raw=1000 result=1025") {
		t.Fatalf("effectBreakdown = %+v, want hp_flat_pick_max pick_max coefficient_bucket evidence", result.EffectBreakdown)
	}
}

func TestSingleAttackerDPSHPChangeFormulaValueSpecUsesAttackerAttributeFormula(t *testing.T) {
	passive := syntheticHPChangeIncomingPhysicalBucketPassive(0)
	passive.Operations[0].ValueSpec = model.DPSModifierValueSpecV2{
		Kind:      "formula",
		FormulaID: "ad_percent_delta",
	}

	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	enableTargetDPSPassivesForTest(curve, "item_hp_change_incoming_physical", passive)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.DamageTimeline) != 1 {
		t.Fatalf("damageTimeline = %+v, want one basic attack damage event", result.DamageTimeline)
	}
	basicAttack := result.DamageTimeline[0]
	if !almostEqual(basicAttack.RawDamage, 110) || !almostEqual(basicAttack.FinalDamage, 110) || !almostEqual(result.TotalDamage, 110) {
		t.Fatalf("damage = raw %.4f final %.4f total %.4f, want 110 from formula ad_percent_delta",
			basicAttack.RawDamage, basicAttack.FinalDamage, result.TotalDamage)
	}
}

func TestSingleAttackerDPSAttributeFormulaValueSpecUsesAttackerAttributeFormula(t *testing.T) {
	passive := model.DPSPassiveEffectV2{
		PassiveID:      "item_formula_ap_multiplier",
		SourceCategory: "item_passive",
		SourceID:       "item_formula_ap_multiplier",
		SourceType:     "item",
		TriggerID:      "formula_ap_multiplier",
		TriggerKind:    dpsTriggerStatAlwaysOn,
		Operations: []model.DPSPassiveOperationV2{{
			Kind:      dpsOpStatModifier,
			Source:    "formula_ap_multiplier",
			BucketKey: "ap_final_multiplier",
			ValueSpec: model.DPSModifierValueSpecV2{
				Kind:      "formula",
				FormulaID: "ad_percent_delta",
			},
		}},
	}

	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, passive)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ap"] = 300
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if got := result.ResolvedSnapshot.AttackerSnapshot.Attributes["ap"]; !almostEqual(got, 330) {
		t.Fatalf("resolved ap = %.4f, want 330 from formula ad_percent_delta percent_delta 0.1", got)
	}
}

func syntheticHPChangeSetFinalPriorityPassives() []model.DPSPassiveEffectV2 {
	return []model.DPSPassiveEffectV2{
		{
			PassiveID:      "set_final_low_priority",
			SourceCategory: "item_passive",
			SourceID:       "set_final_low_priority",
			SourceType:     "item",
			TriggerID:      "set_final_low_priority",
			OwnerRole:      "target",
			Trigger: model.DPSPassiveTriggerSpecV2{
				Event: dpsEventOnDamageTaken,
				Matcher: model.DPSPassiveTriggerMatcherV2{
					DamageTypes:    []string{"physical"},
					ExcludePhantom: true,
				},
			},
			Operations: []model.DPSPassiveOperationV2{{
				Kind:       dpsOpDamageModifier,
				Source:     "set_final_low_priority",
				TargetRole: "target",
				BucketKey:  "incoming_set_final_test",
				Priority:   10,
				ValueSpec:  model.DPSModifierValueSpecV2{Kind: "literal", Value: 50},
			}},
		},
		{
			PassiveID:      "set_final_high_priority",
			SourceCategory: "item_passive",
			SourceID:       "set_final_high_priority",
			SourceType:     "item",
			TriggerID:      "set_final_high_priority",
			OwnerRole:      "target",
			Trigger: model.DPSPassiveTriggerSpecV2{
				Event: dpsEventOnDamageTaken,
				Matcher: model.DPSPassiveTriggerMatcherV2{
					DamageTypes:    []string{"physical"},
					ExcludePhantom: true,
				},
			},
			Operations: []model.DPSPassiveOperationV2{{
				Kind:       dpsOpDamageModifier,
				Source:     "set_final_high_priority",
				TargetRole: "target",
				BucketKey:  "incoming_set_final_test",
				Priority:   20,
				ValueSpec:  model.DPSModifierValueSpecV2{Kind: "literal", Value: 80},
			}},
		},
	}
}

func TestSingleAttackerDPSHPChangeOperationPriorityDeterminesSetFinalResult(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	enableTargetDPSPassivesForTest(curve, "set_final_low_priority", syntheticHPChangeSetFinalPriorityPassives()...)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.DamageTimeline) != 1 {
		t.Fatalf("damageTimeline = %+v, want one basic attack damage event", result.DamageTimeline)
	}
	basicAttack := result.DamageTimeline[0]
	if !almostEqual(basicAttack.RawDamage, 80) || !almostEqual(basicAttack.FinalDamage, 80) || !almostEqual(result.TotalDamage, 80) {
		t.Fatalf("damage = raw %.4f final %.4f total %.4f, want 80 from higher-priority set_final candidate",
			basicAttack.RawDamage, basicAttack.FinalDamage, result.TotalDamage)
	}
}

func TestSingleAttackerDPSCoefficientBucketEvidenceIncludesEvidenceKey(t *testing.T) {
	passive := syntheticHPChangeIncomingPhysicalBucketPassive(-0.2)
	passive.Operations[0].EvidenceKey = "incoming_physical_reduction_evidence"

	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	enableTargetDPSPassivesForTest(curve, "item_hp_change_incoming_physical", passive)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if !effectBreakdownMessageContains(result, dpsEffectCoefficientBucket, "evidenceKey=incoming_physical_reduction_evidence") {
		t.Fatalf("effectBreakdown = %+v, want coefficient_bucket evidenceKey", result.EffectBreakdown)
	}
}

func syntheticHPChangeCoefficientModifierPassive(value float64) model.DPSPassiveEffectV2 {
	passive := syntheticIncomingDamageModifierPassive()
	passive.PassiveID = "item_hp_change_coefficient_modifier_test"
	passive.SourceID = "item_hp_change_coefficient_modifier"
	passive.TriggerID = "hp_change_coefficient_modifier"
	passive.Operations = []model.DPSPassiveOperationV2{{
		Kind:      dpsOpCoefficientModifier,
		Source:    "hp_change_coefficient_modifier",
		BucketKey: "incoming_physical_reduction",
		Value:     value,
	}}
	return passive
}

func syntheticAttributeCoefficientModifierPassive(value float64) model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:      "item_attribute_coefficient_modifier_test",
		SourceCategory: "item_passive",
		SourceID:       "item_attribute_coefficient_modifier",
		SourceType:     "item",
		TriggerID:      "attribute_coefficient_modifier",
		TriggerKind:    dpsTriggerStatAlwaysOn,
		Operations: []model.DPSPassiveOperationV2{{
			Kind:      dpsOpCoefficientModifier,
			Source:    "attribute_coefficient_modifier",
			BucketKey: "ap_final_multiplier",
			Value:     value,
		}},
	}
}

func TestSingleAttackerDPSCoefficientModifierDrivesHPChangeBucket(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	enableTargetDPSPassivesForTest(curve, "item_hp_change_coefficient_modifier", syntheticHPChangeCoefficientModifierPassive(-0.2))
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.DamageTimeline) != 1 {
		t.Fatalf("damageTimeline = %+v, want one basic attack damage event", result.DamageTimeline)
	}
	basicAttack := result.DamageTimeline[0]
	if !almostEqual(basicAttack.RawDamage, 80) || !almostEqual(basicAttack.FinalDamage, 80) {
		t.Fatalf("basic attack damage = raw %.4f final %.4f, want 80 from coefficient_modifier hp_change bucket", basicAttack.RawDamage, basicAttack.FinalDamage)
	}
	if !effectBreakdownMessageContains(result, dpsEffectCoefficientBucket, "domain=hp_change stageKey="+dpsHPChangeStageIncomingPreMitigation+" bucketKey=incoming_physical_reduction aggregationMode=add valueUnit=percent_delta raw=100 result=80") {
		t.Fatalf("effectBreakdown = %+v, want coefficient_bucket evidence for hp_change coefficient_modifier", result.EffectBreakdown)
	}
}

func syntheticSpellHitAttributeCoefficientModifierPassive(value float64) model.DPSPassiveEffectV2 {
	return model.DPSPassiveEffectV2{
		PassiveID:      "item_spell_hit_attribute_coefficient_modifier_test",
		SourceCategory: "item_passive",
		SourceID:       "item_spell_hit_attribute_coefficient_modifier",
		SourceType:     "item",
		TriggerID:      "spell_hit_attribute_coefficient_modifier",
		OwnerRole:      "attacker",
		Trigger: model.DPSPassiveTriggerSpecV2{
			Event: dpsEventOnSpellHit,
			Matcher: model.DPSPassiveTriggerMatcherV2{
				DamageTypes: []string{"magic"},
				ActionTypes: model.TypeMatcherV2{Any: []string{"action/cast_skill"}},
				EffectTags:  model.TypeMatcherV2{Any: []string{"skill_tag/spell_damage"}},
			},
		},
		Operations: []model.DPSPassiveOperationV2{{
			Kind:      dpsOpCoefficientModifier,
			Source:    "spell_hit_attribute_coefficient_modifier",
			BucketKey: "ap_final_multiplier",
			Value:     value,
		}},
	}
}

func TestSingleAttackerDPSDispatchAttributeCoefficientModifierOnSpellHit(t *testing.T) {
	passive := syntheticSpellHitAttributeCoefficientModifierPassive(0.3)
	bundle := compileDPSTestBundle(t)
	input := baseSingleAttackerDPSInput()
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, passive)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ap"] = 300
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 1000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := model.DPSCurveResultV2{
		Status:                  dpsStatusOK,
		DamageTimeline:          make([]model.DPSDamageEventV2, 0),
		DamageByType:            map[string]float64{},
		DamageBySource:          map[string]float64{},
		SkillPassiveTriggers:    make([]model.DPSPassiveTriggerV2, 0),
		ItemPassiveTriggers:     make([]model.DPSPassiveTriggerV2, 0),
		ExternalPassiveTriggers: make([]model.DPSPassiveTriggerV2, 0),
		EffectBreakdown:         make([]model.DPSEffectBreakdownV2, 0),
		BlockedReasons:          make([]string, 0),
	}
	rules := normalizeDPSRules(input.SimulationRules)
	state := newDPSCurveState(bundle, rules, *curve, &result, curve.ResolvedSnapshot.AttackerSnapshot, curve.ResolvedSnapshot.TargetSnapshot)
	if result.Status == dpsStatusBlocked {
		t.Fatalf("newDPSCurveState blocked: %v", result.BlockedReasons)
	}
	ctx := dpsCombatEventContext{
		Event:          dpsEventOnSpellHit,
		TimeMs:         500,
		SourceRole:     dpsRoleAttacker,
		TargetRole:     dpsRoleTarget,
		ActionID:       "synthetic_spell",
		ActionTypes:    []string{"action/cast_skill"},
		EffectTypes:    []string{string(model.EffectTypeDealDamage)},
		EffectTags:     []string{"skill_tag/spell_damage"},
		SourceType:     "spell",
		SourceCategory: "spell",
		SourceID:       "synthetic_spell",
		DamageType:     "magic",
		RawDamage:      100,
		TargetHPBefore: state.targetHP,
		IsSpell:        true,
		IsOnHit:        true,
	}
	state.dispatchDPSLinkedEffects(ctx)
	if result.Status != dpsStatusOK {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if got := state.attrs["ap"]; !almostEqual(got, 390) {
		t.Fatalf("resolved ap = %.4f, want 390 after event-triggered attribute coefficient_modifier", got)
	}
	if !effectBreakdownMessageContains(result, dpsEffectCoefficientBucket, "domain=attribute stageKey="+dpsAttributeStageFinalMultiplier+" bucketKey=ap_final_multiplier aggregationMode=add valueUnit=percent_delta raw=300 result=390") {
		t.Fatalf("effectBreakdown = %+v, want coefficient_bucket evidence from dispatch path", result.EffectBreakdown)
	}
}

func TestSingleAttackerDPSCoefficientModifierDrivesAttributeBucket(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	skillOnlyDPSCurveSetup(curve)
	enableDPSPassivesForTest(curve, syntheticAttributeCoefficientModifierPassive(0.3))
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ap"] = 300
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if got := result.ResolvedSnapshot.AttackerSnapshot.Attributes["ap"]; !almostEqual(got, 390) {
		t.Fatalf("resolved ap = %.4f, want 390 after coefficient_modifier attribute bucket", got)
	}
	if !almostEqual(result.DamageBySource[dpsTestCooldownSkillSkillID], 390) {
		t.Fatalf("damageBySource = %v, want skill damage 390 from coefficient_modifier attribute bucket", result.DamageBySource)
	}
	if !effectBreakdownMessageContains(result, dpsEffectCoefficientBucket, "domain=attribute stageKey="+dpsAttributeStageFinalMultiplier+" bucketKey=ap_final_multiplier aggregationMode=add valueUnit=percent_delta raw=300 result=390") {
		t.Fatalf("effectBreakdown = %+v, want coefficient_bucket evidence for attribute coefficient_modifier", result.EffectBreakdown)
	}
}

func TestSingleAttackerDPSCoefficientModifierRejectsUnsupportedValueSpecKind(t *testing.T) {
	passive := syntheticHPChangeCoefficientModifierPassive(-0.2)
	passive.Operations[0].Value = 0
	passive.Operations[0].ValueSpec = model.DPSModifierValueSpecV2{Kind: "unsupported_kind", Value: 1}

	input := baseSingleAttackerDPSInput()
	curve := &input.Curves[0]
	enableTargetDPSPassivesForTest(curve, "item_hp_change_coefficient_modifier", passive)

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "blocked" {
		t.Fatalf("status = %s, want blocked for unsupported valueSpec kind", result.Status)
	}
	if !blockedReasonContains(result, "coefficient_modifier valueSpec has unsupported kind unsupported_kind") {
		t.Fatalf("blockedReasons = %v, want unsupported valueSpec kind rejection", result.BlockedReasons)
	}
}

func compileDPSTestBundlePatched(t *testing.T, patch func(*model.EngineBundle)) compilebundle.CompiledBundle {
	t.Helper()
	bundle := dpsTestEngineBundle()
	if patch != nil {
		patch(&bundle)
	}
	result := compilebundle.Bundle(bundle)
	if len(result.Problems) > 0 {
		t.Fatalf("compile dps test bundle: %v", result.Problems)
	}
	return result.Bundle
}

func runSingleAttackerDPSWithBundle(t *testing.T, bundle compilebundle.CompiledBundle, input model.SingleAttackerDPSInputV2) model.SingleAttackerDPSOutputV2 {
	t.Helper()
	return runSingleAttackerDPS(bundle, input)
}

func findStatModifierBreakdownAmount(result model.DPSCurveResultV2, source string) (float64, bool) {
	for _, item := range result.EffectBreakdown {
		if item.Kind != dpsOpStatModifier || item.Source != source {
			continue
		}
		return item.Amount, true
	}
	return 0, false
}

func TestSingleAttackerDPSInitialSnapshotAttributeBounds(t *testing.T) {
	bundle := compileDPSTestBundlePatched(t, func(bundle *model.EngineBundle) {
		for i, attr := range bundle.Attributes {
			if attr.ID != "crit_chance" {
				continue
			}
			bundle.Attributes[i].HasClampMin = true
			bundle.Attributes[i].ClampMin = 0
			bundle.Attributes[i].HasClampMax = true
			bundle.Attributes[i].ClampMax = 1
		}
	})
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["crit_chance"] = 1.25
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1

	result := runSingleAttackerDPSWithBundle(t, bundle, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if got := result.ResolvedSnapshot.AttackerSnapshot.Attributes["crit_chance"]; !almostEqual(got, 1) {
		t.Fatalf("resolved crit_chance = %.4f, want 1", got)
	}
}

func TestSingleAttackerDPSOverCapCritChanceEvidenceDoesNotSynthesizeAttributeView(t *testing.T) {
	bundle := compileDPSTestBundlePatched(t, func(bundle *model.EngineBundle) {
		for i, attr := range bundle.Attributes {
			if attr.ID != "crit_chance" {
				continue
			}
			bundle.Attributes[i].HasClampMin = true
			bundle.Attributes[i].ClampMin = 0
			bundle.Attributes[i].HasClampMax = true
			bundle.Attributes[i].ClampMax = 1
		}
	})
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 500
	passive := attackerAttrRatioOnHitPassive("missing_crit_base_view", "crit_chance", 2, model.AttrReadBase)
	curve := &input.Curves[0]
	curve.CurveID = "over-cap-crit-evidence-no-view-synthesis"
	enableDPSPassivesForTest(curve, passive)
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["crit_chance"] = 1.25
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1

	result := runSingleAttackerDPSWithBundle(t, bundle, input).CurveResults[0]
	if result.Status != "blocked" {
		t.Fatalf("status = %s, want blocked when base view is missing even with over-cap crit_chance", result.Status)
	}
	if !blockedReasonContains(result, "requires attacker attr view crit_chance for read base") {
		t.Fatalf("blockedReasons = %v, want missing base view block", result.BlockedReasons)
	}
}

func TestSingleAttackerDPSBasicAttackCritChanceBoundEvidence(t *testing.T) {
	bundle := compileDPSTestBundlePatched(t, func(bundle *model.EngineBundle) {
		for i, attr := range bundle.Attributes {
			if attr.ID != "crit_chance" {
				continue
			}
			bundle.Attributes[i].HasClampMin = true
			bundle.Attributes[i].ClampMin = 0
			bundle.Attributes[i].HasClampMax = true
			bundle.Attributes[i].ClampMax = 1
		}
	})
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["crit_chance"] = 1.25
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["crit_damage"] = 2
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSWithBundle(t, bundle, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if len(result.DamageTimeline) != 1 || !almostEqual(result.DamageTimeline[0].FinalDamage, 200) {
		t.Fatalf("damageTimeline = %+v, want bounded expected crit damage 200", result.DamageTimeline)
	}
	critCtx := result.DamageTimeline[0].CritContext
	if critCtx == nil {
		t.Fatalf("critContext missing, want bound evidence for raw 1.25 -> 1")
	}
	if !almostEqual(critCtx.ChanceRaw, 1.25) || !almostEqual(critCtx.ChanceEffective, 1) {
		t.Fatalf("critContext chance = raw %.4f effective %.4f, want raw 1.25 effective 1", critCtx.ChanceRaw, critCtx.ChanceEffective)
	}
	bound := critCtx.BoundEvidence
	if bound == nil || !bound.WasClamped || !almostEqual(bound.RawValue, 1.25) || !almostEqual(bound.BoundedValue, 1) {
		t.Fatalf("critContext.boundEvidence = %+v, want wasClamped raw=1.25 bounded=1", bound)
	}
}

func TestSingleAttackerDPSStatModifierAttributeBounds(t *testing.T) {
	bundle := compileDPSTestBundlePatched(t, func(bundle *model.EngineBundle) {
		for i, attr := range bundle.Attributes {
			if attr.ID != "attack_speed" {
				continue
			}
			bundle.Attributes[i].HasClampMin = true
			bundle.Attributes[i].ClampMin = 0
			bundle.Attributes[i].HasClampMax = true
			bundle.Attributes[i].ClampMax = 2
		}
	})
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	enableDPSPassivesForTest(curve, model.DPSPassiveEffectV2{
		PassiveID:      "test_attack_speed_buff",
		SourceCategory: "item_passive",
		SourceID:       "test_attack_speed_buff",
		SourceType:     "item",
		TriggerID:      "test_attack_speed_buff",
		TriggerKind:    dpsTriggerStatAlwaysOn,
		Operations: []model.DPSPassiveOperationV2{{
			Kind:         dpsOpStatModifier,
			Source:       "test_attack_speed_buff",
			AttrKey:      "attack_speed",
			ModifierMode: "percent",
			Value:        1,
		}},
	})
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1.5

	result := runSingleAttackerDPSWithBundle(t, bundle, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if got := result.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"]; !almostEqual(got, 2) {
		t.Fatalf("resolved attack_speed = %.4f, want 2", got)
	}
	amount, ok := findStatModifierBreakdownAmount(result, "test_attack_speed_buff")
	if !ok || !almostEqual(amount, 2) {
		t.Fatalf("stat_modifier breakdown amount = %.4f ok=%v, want 2", amount, ok)
	}
}

func TestSingleAttackerDPSAttributeBucketAttributeBounds(t *testing.T) {
	bundle := compileDPSTestBundlePatched(t, func(bundle *model.EngineBundle) {
		for i, attr := range bundle.Attributes {
			if attr.ID != "ap" {
				continue
			}
			bundle.Attributes[i].HasClampMax = true
			bundle.Attributes[i].ClampMax = 350
		}
	})
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 1
	curve := &input.Curves[0]
	skillOnlyDPSCurveSetup(curve)
	enableDPSPassivesForTest(curve, syntheticRabadonAPFinalMultiplierPassive())
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ap"] = 300
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = 10000
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0

	result := runSingleAttackerDPSWithBundle(t, bundle, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if got := result.ResolvedSnapshot.AttackerSnapshot.Attributes["ap"]; !almostEqual(got, 350) {
		t.Fatalf("resolved ap = %.4f, want 350 after bucket + attribute bounds", got)
	}
}

func collectorExecutePassive(thresholdType string, thresholdValue float64, checkTiming string) model.DPSPassiveEffectV2 {
	op := model.DPSPassiveOperationV2{
		Kind:           dpsOpExecuteThreshold,
		Source:         "collector_execute",
		TargetRole:     "target",
		ThresholdType:  thresholdType,
		ThresholdValue: thresholdValue,
	}
	if checkTiming != "" {
		op.CheckTiming = checkTiming
	}
	return model.DPSPassiveEffectV2{
		PassiveID:      "collector_execute_test",
		SourceCategory: "item_passive",
		SourceID:       "collector_execute",
		SourceType:     "item",
		TriggerID:      "collector_execute_on_damage_dealt",
		Trigger: model.DPSPassiveTriggerSpecV2{
			Event: dpsEventOnDamageDealt,
		},
		Operations: []model.DPSPassiveOperationV2{op},
	}
}

func configureExecuteThresholdAttackSetup(curve *model.DPSCurveRunSpecV2, targetCurrentHP float64, targetMaxHP float64) {
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	curve.ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	curve.ResolvedSnapshot.TargetSnapshot.CurrentHP = targetCurrentHP
	curve.ResolvedSnapshot.TargetSnapshot.MaxHP = targetMaxHP
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["hp"] = targetMaxHP
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 0
	curve.ResolvedSnapshot.TargetSnapshot.Attributes["magic_resist"] = 0
}

func findExecuteThresholdBreakdown(result model.DPSCurveResultV2, triggered bool) (model.DPSEffectBreakdownV2, bool) {
	wantTriggered := "triggered=" + boolToString(triggered)
	for _, entry := range result.EffectBreakdown {
		if entry.Kind != dpsOpExecuteThreshold {
			continue
		}
		if strings.Contains(entry.Message, wantTriggered) {
			return entry, true
		}
	}
	return model.DPSEffectBreakdownV2{}, false
}

func TestSingleAttackerDPSExecuteThresholdRatioNotReached(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 500
	curve := &input.Curves[0]
	configureExecuteThresholdAttackSetup(curve, 160, 1000)
	enableDPSPassivesForTest(curve, collectorExecutePassive(dpsThresholdTypeCurrentHPRatio, 0.05, dpsCheckTimingAfterDamage))

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" {
		t.Fatalf("status = %s blockedReasons=%v, want ok", result.Status, result.BlockedReasons)
	}
	if result.StopReason == dpsStopReasonExecuteThreshold {
		t.Fatalf("stopReason = %q, want no execute stop", result.StopReason)
	}
	if result.TargetHPTimeline[len(result.TargetHPTimeline)-1].CurrentHP <= 0 {
		t.Fatalf("target HP should remain above 0, timeline=%v", result.TargetHPTimeline)
	}
	if _, ok := findExecuteThresholdBreakdown(result, true); ok {
		t.Fatal("execute evidence should not report triggered=true")
	}
}

func TestSingleAttackerDPSExecuteThresholdRatioReached(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 5000
	curve := &input.Curves[0]
	configureExecuteThresholdAttackSetup(curve, 140, 1000)
	enableDPSPassivesForTest(curve, collectorExecutePassive(dpsThresholdTypeCurrentHPRatio, 0.05, dpsCheckTimingAfterDamage))

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" || result.StopReason != dpsStopReasonExecuteThreshold {
		t.Fatalf("status/stopReason = %s/%s, want ok/%s", result.Status, result.StopReason, dpsStopReasonExecuteThreshold)
	}
	if result.KillTimeMs == nil || *result.KillTimeMs != 0 {
		t.Fatalf("killTimeMs = %v, want 0", result.KillTimeMs)
	}
	if len(result.DamageTimeline) != 1 {
		t.Fatalf("damage timeline length = %d, want only normal damage", len(result.DamageTimeline))
	}
	if got := result.DamageBySource[dpsTestDefaultBasicAttackSkillID]; !almostEqual(got, 100) {
		t.Fatalf("damageBySource basic attack = %.4f, want 100 without execute amount", got)
	}
	if _, ok := result.DamageBySource["collector_execute"]; ok {
		t.Fatalf("damageBySource should not contain execute source: %v", result.DamageBySource)
	}
	breakdown, ok := findExecuteThresholdBreakdown(result, true)
	if !ok {
		t.Fatal("missing triggered execute_threshold effect evidence")
	}
	if breakdown.Amount != 0 {
		t.Fatalf("execute evidence amount = %.4f, want 0", breakdown.Amount)
	}
	if !strings.Contains(breakdown.Message, "thresholdType=current_hp_ratio") ||
		!strings.Contains(breakdown.Message, "hpBeforeCheck=40") ||
		!strings.Contains(breakdown.Message, "maxHp=1000") ||
		!strings.Contains(breakdown.Message, "currentHpRatio=0.04") {
		t.Fatalf("execute evidence message = %q, want threshold inspection fields", breakdown.Message)
	}
	lastHP := result.TargetHPTimeline[len(result.TargetHPTimeline)-2]
	if lastHP.CurrentHP != 0 || lastHP.TimeMs != 0 {
		t.Fatalf("target HP timeline at execute = %+v, want HP=0 at 0ms", lastHP)
	}
}

func TestSingleAttackerDPSExecuteThresholdValueReached(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 5000
	curve := &input.Curves[0]
	configureExecuteThresholdAttackSetup(curve, 140, 1000)
	enableDPSPassivesForTest(curve, collectorExecutePassive(dpsThresholdTypeCurrentHPValue, 50, dpsCheckTimingAfterDamage))

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" || result.StopReason != dpsStopReasonExecuteThreshold {
		t.Fatalf("status/stopReason = %s/%s, want ok/%s", result.Status, result.StopReason, dpsStopReasonExecuteThreshold)
	}
	breakdown, ok := findExecuteThresholdBreakdown(result, true)
	if !ok {
		t.Fatal("missing triggered execute_threshold effect evidence")
	}
	if !strings.Contains(breakdown.Message, "thresholdType=current_hp_value") ||
		!strings.Contains(breakdown.Message, "hpBeforeCheck=40") {
		t.Fatalf("execute evidence message = %q, want value threshold fields", breakdown.Message)
	}
}

func TestSingleAttackerDPSExecuteThresholdSkippedWhenNormalDamageKills(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 5000
	curve := &input.Curves[0]
	configureExecuteThresholdAttackSetup(curve, 80, 1000)
	enableDPSPassivesForTest(curve, collectorExecutePassive(dpsThresholdTypeCurrentHPRatio, 0.05, dpsCheckTimingAfterDamage))

	result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
	if result.Status != "ok" || result.StopReason != "target_dead" {
		t.Fatalf("status/stopReason = %s/%s, want ok/target_dead", result.Status, result.StopReason)
	}
	if _, ok := findExecuteThresholdBreakdown(result, true); ok {
		t.Fatal("execute evidence should not trigger when normal damage already killed target")
	}
	if _, ok := findExecuteThresholdBreakdown(result, false); ok {
		t.Fatal("execute evidence should not be appended when target already dead")
	}
}

func TestSingleAttackerDPSBlocksInvalidExecuteThresholdContracts(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*model.DPSPassiveOperationV2)
		needle string
	}{
		{
			name: "negative threshold value",
			mutate: func(op *model.DPSPassiveOperationV2) {
				op.ThresholdValue = -0.01
			},
			needle: "execute_threshold has invalid thresholdValue",
		},
		{
			name: "non-finite threshold value",
			mutate: func(op *model.DPSPassiveOperationV2) {
				op.ThresholdValue = math.NaN()
			},
			needle: "execute_threshold has invalid thresholdValue",
		},
		{
			name: "unsupported threshold type",
			mutate: func(op *model.DPSPassiveOperationV2) {
				op.ThresholdType = "missing_hp_ratio"
			},
			needle: "execute_threshold has unsupported thresholdType",
		},
		{
			name: "unsupported check timing",
			mutate: func(op *model.DPSPassiveOperationV2) {
				op.CheckTiming = "before_damage"
			},
			needle: "execute_threshold has unsupported checkTiming",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			input := baseSingleAttackerDPSInput()
			curve := &input.Curves[0]
			configureExecuteThresholdAttackSetup(curve, 140, 1000)
			passive := collectorExecutePassive(dpsThresholdTypeCurrentHPRatio, 0.05, dpsCheckTimingAfterDamage)
			tc.mutate(&passive.Operations[0])
			enableDPSPassivesForTest(curve, passive)

			result := runSingleAttackerDPSForTest(t, input).CurveResults[0]
			if result.Status != "blocked" || result.StopReason != "blocked" {
				t.Fatalf("status/stopReason = %s/%s, want blocked/blocked", result.Status, result.StopReason)
			}
			if !blockedReasonContains(result, tc.needle) {
				t.Fatalf("blockedReasons = %v, want %q", result.BlockedReasons, tc.needle)
			}
		})
	}
}
