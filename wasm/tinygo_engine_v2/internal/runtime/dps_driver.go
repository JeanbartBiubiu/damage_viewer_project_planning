package runtime

import (
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func runSingleAttackerDPS(bundle compilebundle.CompiledBundle, input model.SingleAttackerDPSInputV2) model.SingleAttackerDPSOutputV2 {
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
		output.CurveResults = append(output.CurveResults, runSingleAttackerDPSCurve(bundle, rules, curve))
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
	bundle compilebundle.CompiledBundle,
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
		AttackerDamageTimeline:  make([]model.DPSAttackerDamageEventV2, 0),
		AttackerDamageBySource:  map[string]float64{},
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

	equipmentReasons := validateDPSEquipment(curve)
	resolvedSnapshot := curve.ResolvedSnapshot
	if len(equipmentReasons) == 0 {
		resolvedSnapshot = applyEquipmentStatsToResolvedSnapshot(resolvedSnapshot)
		curve.ResolvedSnapshot = resolvedSnapshot
		result.ResolvedSnapshot = resolvedSnapshot
	}
	attacker := resolvedSnapshot.AttackerSnapshot
	target := resolvedSnapshot.TargetSnapshot

	blockedReasons := validateDPSCurve(bundle, rules, curve, attacker, target)
	blockedReasons = append(equipmentReasons, blockedReasons...)
	if len(blockedReasons) > 0 {
		result.Status = dpsStatusBlocked
		result.StopReason = "blocked"
		result.BlockedReasons = blockedReasons
		return result
	}

	state := newDPSCurveState(bundle, rules, curve, &result, attacker, target)
	if result.Status == dpsStatusBlocked {
		return result
	}
	state.applyInitialStatModifiers()
	if result.Status == dpsStatusBlocked {
		return result
	}
	state.initEnergizedCharge()
	if result.Status == dpsStatusBlocked {
		return result
	}
	state.initActiveActionSchedules()
	state.TargetHPTimelineAppend(0)
	result.FinalTimeMs = rules.DurationMs

	for {
		nextDotAtMs, hasDot := state.nextDotTick()
		nextActionAtMs, hasAction := state.nextActiveActionAtMs()
		if !hasDot && !hasAction {
			break
		}
		if hasDot && (!hasAction || nextDotAtMs <= nextActionAtMs) {
			state.processDotTick(nextDotAtMs)
			if state.shouldStopAfterEvent(nextDotAtMs) {
				break
			}
			continue
		}

		state.processActiveActionsAt(nextActionAtMs)
		if state.shouldStopAfterEvent(nextActionAtMs) {
			break
		}
	}

	if result.StopReason == "duration_elapsed" {
		result.FinalTimeMs = rules.DurationMs
	}
	if rules.DurationMs > 0 {
		result.TimeWindowDps = result.TotalDamage / (float64(rules.DurationMs) / 1000)
	}
	return result
}
