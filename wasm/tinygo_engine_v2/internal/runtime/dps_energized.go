// energized charge 状态机与证据记录。
package runtime

import (
	"strings"
	"tinygo_engine_v2/internal/model"
)

func (state *dpsCurveState) initEnergizedCharge() {
	for _, passive := range state.passives {
		if passive.TriggerKind != dpsTriggerEnergizedChargeAndConsume {
			continue
		}
		chargeKey := strings.TrimSpace(passive.ChargeKey)
		if chargeKey == "" {
			continue
		}
		if _, exists := state.energizedCharge[chargeKey]; exists {
			continue
		}
		cap := effectiveDPSChargeCap(passive)
		initial := 0.0
		for _, scenario := range state.curve.ResolvedSnapshot.ScenarioStates {
			if scenario.StateID != chargeKey || scenario.Activation != "assumed_charge_before_start" {
				continue
			}
			initial = float64(scenario.Stacks)
			break
		}
		initial = clampDPSCharge(initial, cap)
		state.energizedCharge[chargeKey] = initial
		if initial >= passive.ChargeThreshold {
			state.energizedReady[chargeKey] = true
		}
	}
}

func effectiveDPSChargeCap(passive model.DPSPassiveEffectV2) float64 {
	if passive.ChargeCap > 0 {
		return passive.ChargeCap
	}
	return passive.ChargeThreshold
}

func clampDPSCharge(value float64, cap float64) float64 {
	if value < 0 {
		return 0
	}
	if value > cap {
		return cap
	}
	return value
}

func (state *dpsCurveState) processEnergizedChargePassive(timeMs int64, passive model.DPSPassiveEffectV2) bool {
	chargeKey := strings.TrimSpace(passive.ChargeKey)
	if chargeKey == "" {
		state.block("passive energized_charge_and_consume requires chargeKey")
		return false
	}
	if _, ok := state.energizedCharge[chargeKey]; !ok {
		state.initEnergizedChargeForKey(passive, chargeKey)
	}
	if !passive.ConsumeChargeOnTrigger {
		state.block("passive energized_charge_and_consume requires consumeChargeOnTrigger=true")
		return false
	}

	cap := effectiveDPSChargeCap(passive)
	threshold := passive.ChargeThreshold
	gain := passive.ChargeGainPerBasicAttack

	preCharge := state.energizedCharge[chargeKey]
	readyBefore := state.energizedReady[chargeKey]

	triggered := false
	consumed := false
	chargeAfterProc := preCharge

	if readyBefore && preCharge >= threshold {
		triggered = true
		state.recordPassiveTrigger(timeMs, passive)
		for _, op := range passive.Operations {
			if state.result.Status == dpsStatusBlocked || state.targetHP <= 0 {
				return triggered
			}
			state.applyPassiveOperation(timeMs, passive, op)
		}
		if passive.ConsumeChargeOnTrigger {
			consumed = true
			chargeAfterProc = 0
			state.energizedReady[chargeKey] = false
		} else {
			state.energizedReady[chargeKey] = false
		}
	}

	state.energizedCharge[chargeKey] = chargeAfterProc
	state.recordEnergizedChargeEvidence(timeMs, passive, dpsEffectEnergizedChargeCheck, chargeKey, preCharge, chargeAfterProc, 0, threshold, readyBefore, state.energizedReady[chargeKey], consumed, triggered)
	if consumed {
		state.recordEnergizedChargeEvidence(timeMs, passive, dpsEffectEnergizedChargeConsume, chargeKey, preCharge, chargeAfterProc, 0, threshold, readyBefore, state.energizedReady[chargeKey], consumed, triggered)
	}

	preGainCharge := state.energizedCharge[chargeKey]
	postCharge := preGainCharge + gain
	if postCharge > cap {
		postCharge = cap
	}
	state.energizedCharge[chargeKey] = postCharge

	readyAfter := state.energizedReady[chargeKey]
	if postCharge >= threshold {
		state.energizedReady[chargeKey] = true
		readyAfter = true
	}

	state.recordEnergizedChargeEvidence(timeMs, passive, dpsEffectEnergizedChargeGain, chargeKey, preGainCharge, postCharge, gain, threshold, readyBefore, readyAfter, consumed, triggered)
	return triggered
}

func (state *dpsCurveState) initEnergizedChargeForKey(passive model.DPSPassiveEffectV2, chargeKey string) {
	cap := effectiveDPSChargeCap(passive)
	initial := 0.0
	for _, scenario := range state.curve.ResolvedSnapshot.ScenarioStates {
		if scenario.StateID != chargeKey || scenario.Activation != "assumed_charge_before_start" {
			continue
		}
		initial = float64(scenario.Stacks)
		break
	}
	initial = clampDPSCharge(initial, cap)
	state.energizedCharge[chargeKey] = initial
	if initial >= passive.ChargeThreshold {
		state.energizedReady[chargeKey] = true
	}
}

func (state *dpsCurveState) recordEnergizedChargeEvidence(
	timeMs int64,
	passive model.DPSPassiveEffectV2,
	kind string,
	chargeKey string,
	preCharge float64,
	postCharge float64,
	chargeGain float64,
	chargeThreshold float64,
	readyBeforeHit bool,
	readyAfterHit bool,
	consumed bool,
	triggered bool,
) {
	state.result.EffectBreakdown = append(state.result.EffectBreakdown, model.DPSEffectBreakdownV2{
		TimeMs:  timeMs,
		Source:  nonEmpty(passive.SourceID, passiveID(passive)),
		Kind:    kind,
		Amount:  postCharge,
		Message: energizedChargeBreakdownMessage(chargeKey, preCharge, postCharge, chargeGain, chargeThreshold, readyBeforeHit, readyAfterHit, consumed, triggered),
	})
}

func energizedChargeBreakdownMessage(
	chargeKey string,
	preCharge float64,
	postCharge float64,
	chargeGain float64,
	chargeThreshold float64,
	readyBeforeHit bool,
	readyAfterHit bool,
	consumed bool,
	triggered bool,
) string {
	return "chargeKey=" + chargeKey +
		" preCharge=" + floatToString(preCharge) +
		" postCharge=" + floatToString(postCharge) +
		" chargeGain=" + floatToString(chargeGain) +
		" chargeThreshold=" + floatToString(chargeThreshold) +
		" readyBeforeHit=" + boolToString(readyBeforeHit) +
		" readyAfterHit=" + boolToString(readyAfterHit) +
		" consumed=" + boolToString(consumed) +
		" triggered=" + boolToString(triggered)
}

func boolToString(value bool) string {
	if value {
		return "true"
	}
	return "false"
}
