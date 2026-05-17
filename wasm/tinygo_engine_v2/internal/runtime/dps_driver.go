package runtime

import (
	"math"

	"tinygo_engine_v2/internal/model"
)

const (
	singleAttackerDPSMode = "single_attacker_dps"
	dpsStatusOK           = "ok"
	dpsStatusBlocked      = "blocked"
)

func RunSingleAttackerDPS(input model.SingleAttackerDPSInputV2) model.SingleAttackerDPSOutputV2 {
	rules := normalizeDPSRules(input.SimulationRules)
	output := model.SingleAttackerDPSOutputV2{
		CaseID:          input.CaseID,
		VersionCode:     input.VersionCode,
		WasmSha256:      input.WasmSha256,
		SimulationRules: rules,
		TargetSnapshot:  input.TargetSnapshot,
		CurveResults:    make([]model.DPSCurveResultV2, 0, len(input.Curves)),
	}
	for _, curve := range input.Curves {
		output.CurveResults = append(output.CurveResults, runSingleAttackerDPSCurve(rules, curve))
	}
	return output
}

func normalizeDPSRules(input model.DPSimulationRulesV2) model.DPSimulationRulesV2 {
	rules := input
	if rules.SampleBy == "" {
		rules.SampleBy = "none"
	}
	if rules.AttackSpeedCap <= 0 {
		rules.AttackSpeedCap = 3.0
	}
	if rules.EventWindowPolicy == "" {
		rules.EventWindowPolicy = "timeMs < durationMs"
	}
	if rules.DotTickIntervalMs <= 0 {
		rules.DotTickIntervalMs = 1000
	}
	if rules.CritPolicy == "" {
		rules.CritPolicy = "expected"
	}
	if rules.MaxEvents <= 0 {
		rules.MaxEvents = 10000
	}
	if rules.AutoAttackPlan.ActionID == "" {
		rules.AutoAttackPlan.ActionID = "basic_attack"
	}
	if rules.AutoAttackPlan.TargetRole == "" {
		rules.AutoAttackPlan.TargetRole = "target"
	}
	if rules.AutoAttackPlan.StartAtMs == 0 && rules.FirstAttackAtMs != 0 {
		rules.AutoAttackPlan.StartAtMs = rules.FirstAttackAtMs
	}
	if rules.FirstAttackAtMs == 0 {
		rules.FirstAttackAtMs = rules.AutoAttackPlan.StartAtMs
	}
	return rules
}

func runSingleAttackerDPSCurve(
	rules model.DPSimulationRulesV2,
	curve model.DPSCurveRunSpecV2,
) model.DPSCurveResultV2 {
	result := model.DPSCurveResultV2{
		CurveID:                 curve.CurveID,
		Status:                  dpsStatusOK,
		Selection:               curve.Selection,
		ResolvedSnapshot:        curve.ResolvedSnapshot,
		DurationMs:              rules.DurationMs,
		StopReason:              "duration_elapsed",
		AttackTimeline:          make([]model.DPSAttackEventV2, 0),
		AttackIntervalTimeline:  make([]model.DPSAttackIntervalV2, 0),
		DamageTimeline:          make([]model.DPSDamageEventV2, 0),
		TargetHPTimeline:        make([]model.DPSTargetHPEventV2, 0),
		EffectTimeline:          make([]model.DPSEffectEventV2, 0),
		DamageByType:            map[string]float64{},
		DamageBySource:          map[string]float64{},
		SkillPassiveTriggers:    make([]model.DPSPassiveTriggerV2, 0),
		ItemPassiveTriggers:     make([]model.DPSPassiveTriggerV2, 0),
		ExternalPassiveTriggers: make([]model.DPSPassiveTriggerV2, 0),
		EffectBreakdown:         make([]model.DPSEffectBreakdownV2, 0),
		CritPolicy:              rules.CritPolicy,
		Seed:                    rules.Seed,
		BlockedReasons:          make([]string, 0),
	}

	attacker := curve.ResolvedSnapshot.AttackerSnapshot
	target := curve.ResolvedSnapshot.TargetSnapshot

	blockedReasons := validateDPSCurve(rules, curve, attacker, target)
	if len(blockedReasons) > 0 {
		result.Status = dpsStatusBlocked
		result.StopReason = "blocked"
		result.BlockedReasons = blockedReasons
		return result
	}

	rawAttackSpeed := readFirstPositiveAttr(attacker.Attributes, "attack_speed", "attackSpeed", "as", "attacks_per_second")
	attackDamage := readFirstFiniteAttr(attacker.Attributes, "ad", "attack_damage", "attackDamage")
	armor := readFirstFiniteAttr(target.Attributes, "armor", "armour")
	targetMaxHP := target.MaxHP
	if targetMaxHP <= 0 {
		targetMaxHP = readFirstPositiveAttr(target.Attributes, "hp", "health", "max_hp", "max_health")
	}
	targetHP := target.CurrentHP
	if targetHP <= 0 {
		targetHP = targetMaxHP
	}
	result.TargetHPTimeline = append(result.TargetHPTimeline, model.DPSTargetHPEventV2{
		TimeMs: 0, CurrentHP: targetHP, MaxHP: targetMaxHP,
	})

	timeMs := rules.AutoAttackPlan.StartAtMs
	if timeMs < 0 {
		timeMs = 0
	}
	result.FinalTimeMs = rules.DurationMs
	for timeMs < rules.DurationMs {
		result.ProcessedEvents++
		result.AttackCount++
		if result.QueuePeak < 1 {
			result.QueuePeak = 1
		}
		result.AttackTimeline = append(result.AttackTimeline, model.DPSAttackEventV2{
			TimeMs:        timeMs,
			ActionID:      rules.AutoAttackPlan.ActionID,
			SourceActorID: nonEmpty(attacker.ActorID, "self"),
			TargetActorID: nonEmpty(target.ActorID, "target"),
		})

		hpBefore := targetHP
		mitigatedDamage, code := mitigateDamageByResistance(attackDamage, armor, "physical")
		if code != model.ErrOK {
			result.Status = dpsStatusBlocked
			result.StopReason = "blocked"
			result.BlockedReasons = append(result.BlockedReasons, "basic attack damage could not be resolved")
			return result
		}
		hpAfter, finalDamage, code := applyDamageToHP(targetHP, mitigatedDamage)
		if code != model.ErrOK {
			result.Status = dpsStatusBlocked
			result.StopReason = "blocked"
			result.BlockedReasons = append(result.BlockedReasons, "basic attack damage could not be applied")
			return result
		}
		targetHP = hpAfter
		result.TotalDamage += finalDamage
		result.DamageByType["physical"] += finalDamage
		result.DamageBySource[rules.AutoAttackPlan.ActionID] += finalDamage
		result.DamageTimeline = append(result.DamageTimeline, model.DPSDamageEventV2{
			TimeMs:         timeMs,
			Source:         rules.AutoAttackPlan.ActionID,
			DamageType:     "physical",
			RawDamage:      attackDamage,
			FinalDamage:    finalDamage,
			TargetHPBefore: hpBefore,
			TargetHPAfter:  targetHP,
		})
		result.TargetHPTimeline = append(result.TargetHPTimeline, model.DPSTargetHPEventV2{
			TimeMs: timeMs, CurrentHP: targetHP, MaxHP: targetMaxHP,
		})

		if targetHP <= 0 {
			killTimeMs := timeMs
			result.KillTimeMs = &killTimeMs
			if killTimeMs > 0 {
				killDPS := result.TotalDamage / (float64(killTimeMs) / 1000)
				result.KillDps = &killDPS
			}
			if rules.DurationMs > timeMs {
				result.TargetHPTimeline = append(result.TargetHPTimeline, model.DPSTargetHPEventV2{
					TimeMs: rules.DurationMs, CurrentHP: 0, MaxHP: targetMaxHP,
				})
			}
			result.FinalTimeMs = rules.DurationMs
			result.StopReason = "target_dead"
			break
		}
		if result.ProcessedEvents >= rules.MaxEvents {
			result.FinalTimeMs = timeMs
			result.StopReason = "event_limit"
			break
		}

		effectiveAttackSpeed := math.Min(rawAttackSpeed, rules.AttackSpeedCap)
		overflowAttackSpeed := math.Max(0, rawAttackSpeed-rules.AttackSpeedCap)
		intervalMs := attackIntervalMs(effectiveAttackSpeed)
		nextAttackAtMs := timeMs + intervalMs
		result.AttackIntervalTimeline = append(result.AttackIntervalTimeline, model.DPSAttackIntervalV2{
			TimeMs:               timeMs,
			RawAttackSpeed:       rawAttackSpeed,
			EffectiveAttackSpeed: effectiveAttackSpeed,
			OverflowAttackSpeed:  overflowAttackSpeed,
			AttackIntervalMs:     intervalMs,
			NextAttackAtMs:       nextAttackAtMs,
			Source:               "attacker.attributes.attack_speed",
		})
		timeMs = nextAttackAtMs
	}
	if result.StopReason == "duration_elapsed" {
		result.FinalTimeMs = rules.DurationMs
	}
	if rules.DurationMs > 0 {
		result.TimeWindowDps = result.TotalDamage / (float64(rules.DurationMs) / 1000)
	}
	return result
}

func validateDPSCurve(
	rules model.DPSimulationRulesV2,
	curve model.DPSCurveRunSpecV2,
	attacker model.DPSActorSnapshotV2,
	target model.DPSActorSnapshotV2,
) []string {
	reasons := make([]string, 0)
	if rules.DurationMs <= 0 {
		reasons = append(reasons, "simulationRules.durationMs must be positive")
	}
	if rules.WarmupMs != 0 {
		reasons = append(reasons, "Batch A only supports simulationRules.warmupMs=0")
	}
	if rules.SampleBy != "none" {
		reasons = append(reasons, "Batch A only supports simulationRules.sampleBy=none")
	}
	if rules.EventWindowPolicy != "timeMs < durationMs" {
		reasons = append(reasons, "Batch A only supports simulationRules.eventWindowPolicy=timeMs < durationMs")
	}
	if rules.DotTickIntervalMs != 1000 {
		reasons = append(reasons, "Batch A only supports simulationRules.dotTickIntervalMs=1000")
	}
	if rules.CritPolicy != "expected" {
		reasons = append(reasons, "Batch A only supports simulationRules.critPolicy=expected")
	}
	if rules.AttackSpeedCap != 3.0 {
		reasons = append(reasons, "Batch A only supports simulationRules.attackSpeedCap=3.0")
	}
	if rules.FirstAttackAtMs != 0 || rules.AutoAttackPlan.StartAtMs != 0 {
		reasons = append(reasons, "Batch A only supports first attack at 0ms")
	}
	if !rules.AutoAttackPlan.Enabled {
		reasons = append(reasons, "simulationRules.autoAttackPlan.enabled must be true")
	}
	if rules.AutoAttackPlan.ActionID != "basic_attack" {
		reasons = append(reasons, "Batch A only supports autoAttackPlan.actionId=basic_attack")
	}
	if rules.AutoAttackPlan.TargetRole != "target" {
		reasons = append(reasons, "Batch A only supports autoAttackPlan.targetRole=target")
	}
	if len(curve.ResolvedSnapshot.EquipmentSet) > 0 || len(curve.Selection.EquipmentSet) > 0 {
		reasons = append(reasons, "Batch A does not support equipmentSet")
	}
	if len(curve.ResolvedSnapshot.EnabledPassiveEffects) > 0 || len(curve.Selection.EnabledPassiveEffects) > 0 {
		reasons = append(reasons, "Batch A does not support enabledPassiveEffects")
	}
	if len(curve.ResolvedSnapshot.ScenarioStates) > 0 || len(curve.Selection.ScenarioStates) > 0 {
		reasons = append(reasons, "Batch A does not support scenarioStates")
	}
	if attacker.ActorID == "" {
		reasons = append(reasons, "resolvedSnapshot.attackerSnapshot is required")
	}
	if target.ActorID == "" {
		reasons = append(reasons, "resolvedSnapshot.targetSnapshot is required")
	}
	if curve.Selection.TargetID == "" {
		reasons = append(reasons, "selection.targetId is required")
	} else if target.ActorID != "" && curve.Selection.TargetID != target.ActorID {
		reasons = append(reasons, "selection.targetId must match resolvedSnapshot.targetSnapshot.actorId")
	}
	if curve.Selection.TargetType != "" && curve.Selection.TargetType != "target_dummy" {
		reasons = append(reasons, "selection.targetType must be target_dummy")
	}
	if target.ActorID != "" && !hasType(target.Types, "target_dummy") {
		reasons = append(reasons, "Batch A requires target_dummy target actor")
	}
	if readFirstPositiveAttr(attacker.Attributes, "attack_speed", "attackSpeed", "as", "attacks_per_second") <= 0 {
		reasons = append(reasons, "attacker attack speed is required")
	}
	if !hasAnyFiniteAttr(attacker.Attributes, "ad", "attack_damage", "attackDamage") {
		reasons = append(reasons, "attacker attack damage is required")
	}
	targetMaxHP := target.MaxHP
	if targetMaxHP <= 0 {
		targetMaxHP = readFirstPositiveAttr(target.Attributes, "hp", "health", "max_hp", "max_health")
	}
	if targetMaxHP <= 0 {
		reasons = append(reasons, "target max hp is required")
	}
	if !hasAnyFiniteAttr(target.Attributes, "armor", "armour") {
		reasons = append(reasons, "target armor is required")
	}
	return reasons
}

func attackIntervalMs(effectiveAttackSpeed float64) int64 {
	if effectiveAttackSpeed <= 0 || math.IsNaN(effectiveAttackSpeed) || math.IsInf(effectiveAttackSpeed, 0) {
		return 0
	}
	interval := int64(math.Round(1000 / effectiveAttackSpeed))
	if interval < 1 {
		return 1
	}
	return interval
}

func readFirstPositiveAttr(attrs map[string]float64, keys ...string) float64 {
	for _, key := range keys {
		value, ok := attrs[key]
		if ok && value > 0 && !math.IsNaN(value) && !math.IsInf(value, 0) {
			return value
		}
	}
	return 0
}

func readFirstFiniteAttr(attrs map[string]float64, keys ...string) float64 {
	for _, key := range keys {
		value, ok := attrs[key]
		if ok && !math.IsNaN(value) && !math.IsInf(value, 0) {
			return value
		}
	}
	return 0
}

func hasAnyFiniteAttr(attrs map[string]float64, keys ...string) bool {
	for _, key := range keys {
		value, ok := attrs[key]
		if ok && !math.IsNaN(value) && !math.IsInf(value, 0) {
			return true
		}
	}
	return false
}

func hasType(types []string, expected string) bool {
	for _, value := range types {
		if value == expected {
			return true
		}
	}
	return false
}

func nonEmpty(value string, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}
