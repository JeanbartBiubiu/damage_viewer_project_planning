// 目标/攻击者 HP 变更与抗性减免。
package runtime

import (
	"math"

	"tinygo_engine_v2/internal/model"
)

func (state *dpsCurveState) TargetHPTimelineAppend(timeMs int64) {
	state.result.TargetHPTimeline = append(state.result.TargetHPTimeline, model.DPSTargetHPEventV2{
		TimeMs: timeMs, CurrentHP: state.targetHP, MaxHP: state.targetMaxHP,
	})
}

func (state *dpsCurveState) applyDamage(timeMs int64, source string, damageType string, rawAmount float64) dpsDamageApplication {
	result := dpsDamageApplication{RawDamage: rawAmount}
	resistance := 0.0
	switch damageType {
	case "physical":
		resistance = state.armor
	case "magic":
		resistance = state.magicResist
	case "true":
	default:
		state.block("unsupported damage type " + damageType)
		return result
	}
	resistance = state.effectiveResistance(damageType, resistance)
	mitigatedDamage, code := mitigateDamageByResistance(rawAmount, resistance, damageType)
	if code != model.ErrOK {
		state.block("damage could not be resolved")
		return result
	}
	hpBefore := state.targetHP
	hpAfter, finalDamage, code := applyDamageToHP(state.targetHP, mitigatedDamage)
	if code != model.ErrOK {
		state.block("damage could not be applied")
		return result
	}
	state.targetHP = hpAfter
	state.result.TotalDamage += finalDamage
	state.result.DamageByType[damageType] += finalDamage
	state.result.DamageBySource[source] += finalDamage
	state.result.DamageTimeline = append(state.result.DamageTimeline, model.DPSDamageEventV2{
		TimeMs:         timeMs,
		Source:         source,
		DamageType:     damageType,
		RawDamage:      rawAmount,
		FinalDamage:    finalDamage,
		TargetHPBefore: hpBefore,
		TargetHPAfter:  state.targetHP,
	})
	state.TargetHPTimelineAppend(timeMs)
	if state.targetHP <= 0 {
		state.markKilled(timeMs)
	}
	result.Applied = true
	result.FinalDamage = finalDamage
	result.TargetHPBefore = hpBefore
	result.TargetHPAfter = state.targetHP
	return result
}

func (state *dpsCurveState) applyAttackerDamage(timeMs int64, source string, damageType string, rawAmount float64) bool {
	if rawAmount < 0 || math.IsNaN(rawAmount) || math.IsInf(rawAmount, 0) {
		state.block("passive retaliation damage resolved invalid amount")
		return false
	}
	if !supportedDPSDamageType(damageType) {
		state.block("unsupported retaliation damage type " + damageType)
		return false
	}
	finalDamage := rawAmount
	state.result.AttackerDamageTimeline = append(state.result.AttackerDamageTimeline, model.DPSAttackerDamageEventV2{
		TimeMs:      timeMs,
		Source:      source,
		DamageType:  damageType,
		RawDamage:   rawAmount,
		FinalDamage: finalDamage,
	})
	if state.result.AttackerDamageBySource == nil {
		state.result.AttackerDamageBySource = map[string]float64{}
	}
	state.result.AttackerDamageBySource[source] += finalDamage
	return true
}

func (state *dpsCurveState) effectiveResistance(damageType string, resistance float64) float64 {
	switch damageType {
	case "physical":
		return applyPositiveResistancePenetration(
			resistance,
			readFirstFiniteAttr(state.attrs, "armor_pen_percent", "physical_pen_percent"),
			readFirstFiniteAttr(state.attrs, "armor_pen_flat", "physical_pen", "lethality"),
		)
	case "magic":
		return applyPositiveResistancePenetration(
			resistance,
			readFirstFiniteAttr(state.attrs, "magic_pen_percent"),
			readFirstFiniteAttr(state.attrs, "magic_pen_flat", "magic_pen"),
		)
	default:
		return resistance
	}
}

func applyPositiveResistancePenetration(resistance float64, percentPen float64, flatPen float64) float64 {
	if resistance <= 0 {
		return resistance
	}
	effective := resistance * (1 - clampFloat(percentPen, 0, 1))
	if flatPen > 0 {
		effective -= flatPen
	}
	if effective < 0 {
		return 0
	}
	return effective
}

func (state *dpsCurveState) markKilled(timeMs int64) {
	killTimeMs := timeMs
	state.result.KillTimeMs = &killTimeMs
	if killTimeMs > 0 {
		killDPS := state.result.TotalDamage / (float64(killTimeMs) / 1000)
		state.result.KillDps = &killDPS
	}
	if state.rules.DurationMs > timeMs {
		state.result.TargetHPTimeline = append(state.result.TargetHPTimeline, model.DPSTargetHPEventV2{
			TimeMs: state.rules.DurationMs, CurrentHP: 0, MaxHP: state.targetMaxHP,
		})
	}
	state.result.FinalTimeMs = state.rules.DurationMs
	state.result.StopReason = "target_dead"
}
