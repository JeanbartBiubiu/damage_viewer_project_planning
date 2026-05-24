package runtime

import (
	"encoding/json"
	"math"
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
				},
				Actions: []string{dpsTestDefaultBasicAttackActionID, dpsTestSecondaryBasicAttackActionID},
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
			{ID: "crit_chance", Op: "attr", Attr: "crit_chance"},
			{ID: "crit_damage", Op: "attr", Attr: "crit_damage"},
			{ID: "attack_speed", Op: "attr", Attr: "attack_speed"},
			{ID: "aa_crit_bonus", Op: "sub", Left: "crit_damage", Right: "one"},
			{ID: "aa_crit_mult", Op: "mul", Left: "crit_chance", Right: "aa_crit_bonus"},
			{ID: "aa_crit_factor", Op: "add", Left: "one", Right: "aa_crit_mult"},
			{ID: "aa_expected_damage", Op: "mul", Left: "attack_damage", Right: "aa_crit_factor"},
			{ID: "as_capped_low", Op: "max", Left: "attack_speed", Right: "as_floor"},
			{ID: "as_capped", Op: "min", Left: "as_capped_low", Right: "as_cap"},
			{ID: "aa_cooldown_ms", Op: "div", Left: "thousand", Right: "as_capped"},
		},
		Actions: []model.ActionTemplate{
			{
				ID:                dpsTestDefaultBasicAttackActionID,
				Label:             "Default Basic Attack",
				Classifier:        model.ClassifierV2{Types: []string{"action/basic_attack"}},
				CooldownFormulaID: "aa_cooldown_ms",
				Effects: []model.EffectDef{
					{
						Type:       "deal_damage",
						FormulaID:  "aa_expected_damage",
						DamageType: "physical",
						SourceRole: "source",
						TargetRole: "target",
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
						Type:       "deal_damage",
						FormulaID:  "aa_expected_damage",
						DamageType: "physical",
						SourceRole: "source",
						TargetRole: "target",
					},
				},
			},
		},
		Settings: model.BundleSettings{MaxEvents: 10000, MaxCommandsPerEvent: 64},
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
	return RunSingleAttackerDPSWithBundle(compileDPSTestBundle(t), input)
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
		Mode:        "single_attacker_dps",
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
