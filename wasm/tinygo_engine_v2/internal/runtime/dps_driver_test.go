package runtime

import (
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestSingleAttackerDPSBasicAttackTimelineStopsOnTargetDeath(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	input.SimulationRules.DurationMs = 10000
	input.Curves[0].ResolvedSnapshot.AttackerSnapshot.Attributes["ad"] = 100
	input.Curves[0].ResolvedSnapshot.AttackerSnapshot.Attributes["attack_speed"] = 1
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.CurrentHP = 125
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.MaxHP = 125
	input.Curves[0].ResolvedSnapshot.TargetSnapshot.Attributes["armor"] = 100

	output := RunSingleAttackerDPS(input)
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

	result := RunSingleAttackerDPS(input).CurveResults[0]
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

func TestSingleAttackerDPSBlockedWhenPublishedSnapshotDataIsMissing(t *testing.T) {
	input := baseSingleAttackerDPSInput()
	delete(input.Curves[0].ResolvedSnapshot.TargetSnapshot.Attributes, "armor")

	result := RunSingleAttackerDPS(input).CurveResults[0]
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

	result := RunSingleAttackerDPS(input).CurveResults[0]
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

	result := RunSingleAttackerDPS(input).CurveResults[0]
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

	result := RunSingleAttackerDPS(input).CurveResults[0]
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

	result := RunSingleAttackerDPS(input).CurveResults[0]
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
			name: "autoAttackAction",
			mutate: func(input *model.SingleAttackerDPSInputV2) {
				input.SimulationRules.AutoAttackPlan.ActionID = "skill_q"
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

			result := RunSingleAttackerDPS(input).CurveResults[0]
			if result.Status != "blocked" || result.StopReason != "blocked" {
				t.Fatalf("status/stopReason = %s/%s, want blocked/blocked", result.Status, result.StopReason)
			}
			if len(result.BlockedReasons) == 0 {
				t.Fatal("blockedReasons should explain unsupported Batch A rules")
			}
		})
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
			AutoAttackPlan: model.DPSAutoAttackPlan{Enabled: true, ActionID: "basic_attack", StartAtMs: 0, TargetRole: "target"},
			MaxEvents:      10000,
		},
		TargetSnapshot: model.DPSActorSnapshotV2{
			ActorID:    "target_dummy_fighter",
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
				AttackerSnapshot: model.DPSActorSnapshotV2{
					ActorID:    "Vayne",
					Name:       "Vayne",
					Level:      1,
					Types:      []string{"champion"},
					CurrentHP:  550,
					MaxHP:      550,
					Attributes: map[string]float64{"hp": 550, "ad": 60, "attack_speed": 0.658},
				},
				TargetSnapshot: model.DPSActorSnapshotV2{
					ActorID:    "target_dummy_fighter",
					Name:       "Target Dummy Fighter",
					Types:      []string{"target_dummy"},
					CurrentHP:  3000,
					MaxHP:      3000,
					Attributes: map[string]float64{"hp": 3000, "armor": 100, "magic_resist": 80},
				},
				EquipmentSet:           []string{},
				EquipmentStats:         map[string]float64{},
				EnabledPassiveEffects:  []string{},
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
