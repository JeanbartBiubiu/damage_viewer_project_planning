// 被动 operation 策略处理器与伤害公式解析。
package runtime

import (
	"math"
	"strings"
	"tinygo_engine_v2/internal/model"
)

func resolvedDPSOperationTargetRole(op model.DPSPassiveOperationV2, kind string) string {
	role := strings.TrimSpace(op.TargetRole)
	if role == "" {
		switch kind {
		case dpsOpDamage, dpsOpApplyDot, dpsOpTriggerDamageAtStacks, dpsOpDamageModifier:
			return dpsRoleTarget
		default:
			return dpsRoleAttacker
		}
	}
	return role
}

func (state *dpsCurveState) applyPassiveOperation(timeMs int64, passive model.DPSPassiveEffectV2, op model.DPSPassiveOperationV2) {
	switch op.Kind {
	case dpsOpDamage:
		stacks := 0
		if op.StackKey != "" {
			stacks = state.stacks[stackRuntimeKey(passive, op.StackKey)]
		}
		amount, attrEvidence, ok := state.resolveOperationAmount(op, stacks)
		if !ok {
			return
		}
		source := passiveDamageSource(passive, op)
		switch resolvedDPSOperationTargetRole(op, dpsOpDamage) {
		case dpsRoleAttacker:
			if state.applyAttackerDamage(timeMs, source, op.DamageType, amount) {
				state.recordPassiveDamageBreakdown(timeMs, passive, op, amount, dpsOpDamage, attrEvidence)
			}
		default:
			if state.applyDamage(timeMs, source, op.DamageType, amount).Applied {
				state.recordPassiveDamageBreakdown(timeMs, passive, op, amount, dpsOpDamage, attrEvidence)
			}
		}
	case dpsOpApplyDot:
		state.applyDot(timeMs, passive, op)
	case dpsOpAddStack:
		state.addStack(timeMs, passive, op)
	case dpsOpTriggerDamageAtStacks:
		state.triggerDamageAtStacks(timeMs, passive, op)
	case dpsOpStatModifier:
		if op.PerStack {
			return
		}
		if strings.TrimSpace(op.BucketKey) != "" {
			state.applyAttributeBucketModifier(timeMs, passive, op)
			return
		}
		state.applyStatModifier(timeMs, passive, op, true)
	case dpsOpCoefficientModifier:
		if op.PerStack {
			return
		}
		if !dpsOperationUsesAttributeBucket(state.bundle, op) {
			return
		}
		state.applyAttributeBucketModifier(timeMs, passive, op)
	}
}

func (state *dpsCurveState) applyAttributeBucketModifier(timeMs int64, passive model.DPSPassiveEffectV2, op model.DPSPassiveOperationV2) {
	gate := state.buildModifierGateContext(dpsCombatEventContext{TimeMs: timeMs})
	entries := []dpsAttributeStatModifierEntry{{passive: passive, op: op, recordTrigger: true}}
	if !state.applyAttributeCoefficientBuckets(timeMs, entries, gate) {
		return
	}
	state.syncTargetResistancesFromAttrs()
}

func (state *dpsCurveState) applyInitialStatModifiers() {
	state.refreshActiveStatModifiers(0)
}

func (state *dpsCurveState) syncTargetResistancesFromAttrs() {
	state.armor = readFirstFiniteAttr(state.targetAttrs, "armor", "armour")
	state.magicResist = readFirstFiniteAttr(state.targetAttrs, "magic_resist", "mr", "spellblock", "spell_block")
}

func (state *dpsCurveState) refreshActiveStatModifiers(timeMs int64) {
	state.attrs = copyDPSFloatMap(state.baseAttrs)
	state.targetAttrs = copyDPSFloatMap(state.targetBaseAttrs)
	bucketEntries := make([]dpsAttributeStatModifierEntry, 0)
	gate := state.buildModifierGateContext(dpsCombatEventContext{TimeMs: timeMs})
	for _, passive := range state.passives {
		if !state.passiveActiveAt(passive, timeMs) {
			continue
		}
		isInitialModifier := passive.TriggerKind == dpsTriggerStatAlwaysOn || passive.TriggerKind == dpsTriggerPreEnabledModifier
		if isInitialModifier {
			triggerKey := "stat_modifier:" + passiveRuntimeKey(passive)
			record := !state.statModifierTriggers[triggerKey]
			if record {
				state.recordPassiveTrigger(timeMs, passive)
				state.statModifierTriggers[triggerKey] = true
			}
			for _, op := range passive.Operations {
				if op.PerStack {
					continue
				}
				if dpsOperationUsesAttributeBucket(state.bundle, op) {
					bucketEntries = append(bucketEntries, dpsAttributeStatModifierEntry{
						passive:       passive,
						op:            op,
						recordTrigger: record,
					})
					continue
				}
				if op.Kind != dpsOpStatModifier {
					continue
				}
				state.applyStatModifier(timeMs, passive, op, record)
			}
		}
		for _, op := range passive.Operations {
			if !op.PerStack {
				continue
			}
			stacks := state.stacks[stackRuntimeKey(passive, op.StackKey)]
			if stacks <= 0 {
				continue
			}
			if dpsOperationUsesAttributeBucket(state.bundle, op) {
				bucketEntries = append(bucketEntries, dpsAttributeStatModifierEntry{
					passive:       passive,
					op:            op,
					recordTrigger: true,
				})
				continue
			}
			if op.Kind != dpsOpStatModifier {
				continue
			}
			state.applyStatModifier(timeMs, passive, op, true)
		}
	}
	if len(bucketEntries) > 0 {
		if !state.applyAttributeCoefficientBuckets(timeMs, bucketEntries, gate) {
			return
		}
	}
	state.boundDPSAttrMap(state.attrs)
	state.boundDPSAttrMap(state.targetAttrs)
	state.syncTargetResistancesFromAttrs()
}

func (state *dpsCurveState) applyStatModifier(timeMs int64, passive model.DPSPassiveEffectV2, op model.DPSPassiveOperationV2, record bool) {
	if op.AttrKey == "" {
		state.block("passive stat_modifier operation requires attrKey")
		return
	}
	targetRole := resolvedDPSOperationTargetRole(op, dpsOpStatModifier)
	attrMap := state.attrs
	if targetRole == dpsRoleTarget {
		attrMap = state.targetAttrs
	}
	current, ok := attrMap[op.AttrKey]
	if !ok || math.IsNaN(current) || math.IsInf(current, 0) {
		state.block("passive stat_modifier operation requires existing attr " + op.AttrKey)
		return
	}
	stacks := 1
	value := op.Value
	if op.PerStack {
		if op.StackKey == "" {
			state.block("passive perStack stat_modifier operation requires stackKey")
			return
		}
		stacks = state.stacks[stackRuntimeKey(passive, op.StackKey)]
		if stacks <= 0 {
			return
		}
		value *= float64(stacks)
	}
	switch op.ModifierMode {
	case "", "flat":
		attrMap[op.AttrKey] = current + value
	case "percent":
		attrMap[op.AttrKey] = current * (1 + value)
	case "override", "override_base", "override_current", "override_max":
		attrMap[op.AttrKey] = value
	default:
		state.block("unsupported passive stat modifier mode " + op.ModifierMode)
		return
	}
	attrMap[op.AttrKey] = state.boundDPSAttrValue(op.AttrKey, attrMap[op.AttrKey])
	if targetRole == dpsRoleTarget {
		state.syncTargetResistancesFromAttrs()
	}
	if !record {
		return
	}
	state.result.EffectTimeline = append(state.result.EffectTimeline, model.DPSEffectEventV2{
		TimeMs: timeMs, SourceID: nonEmpty(passive.SourceID, passiveID(passive)), Kind: dpsOpStatModifier,
	})
	amount := state.attrs[op.AttrKey]
	if targetRole == dpsRoleTarget {
		amount = state.targetAttrs[op.AttrKey]
	}
	state.result.EffectBreakdown = append(state.result.EffectBreakdown, model.DPSEffectBreakdownV2{
		TimeMs:  timeMs,
		Source:  passiveDamageSource(passive, op),
		Kind:    dpsOpStatModifier,
		Amount:  amount,
		Message: statModifierBreakdownMessage(op, stacks, targetRole),
	})
}

func (state *dpsCurveState) addStack(timeMs int64, passive model.DPSPassiveEffectV2, op model.DPSPassiveOperationV2) {
	if op.StackKey == "" {
		state.block("passive add_stack operation requires stackKey")
		return
	}
	if op.RefreshMode != "" && op.RefreshMode != "refresh" {
		state.block("passive add_stack operation has unsupported refreshMode " + op.RefreshMode)
		return
	}
	key := stackRuntimeKey(passive, op.StackKey)
	before := state.stacks[key]
	current := before + 1
	if op.MaxStacks > 0 && current > op.MaxStacks {
		current = op.MaxStacks
	}
	state.stacks[key] = current
	expireAt := int64(0)
	if op.DurationMs > 0 {
		expireAt = timeMs + op.DurationMs
		state.stackExpiry[key] = expireAt
	}
	state.result.EffectTimeline = append(state.result.EffectTimeline, model.DPSEffectEventV2{
		TimeMs: timeMs, SourceID: nonEmpty(passive.SourceID, passiveID(passive)), Kind: dpsOpAddStack,
	})
	state.result.EffectBreakdown = append(state.result.EffectBreakdown, model.DPSEffectBreakdownV2{
		TimeMs:  timeMs,
		Source:  passiveDamageSource(passive, op),
		Kind:    dpsOpAddStack,
		Amount:  float64(current),
		Message: stackBreakdownMessage(op.StackKey, before, current, op.MaxStacks, expireAt),
	})
}

func (state *dpsCurveState) triggerDamageAtStacks(timeMs int64, passive model.DPSPassiveEffectV2, op model.DPSPassiveOperationV2) {
	if op.StackKey == "" {
		state.block("passive trigger_damage_at_stacks operation requires stackKey")
		return
	}
	triggerStacks := op.TriggerStacks
	if triggerStacks <= 0 {
		triggerStacks = op.MaxStacks
	}
	key := stackRuntimeKey(passive, op.StackKey)
	if triggerStacks <= 0 || state.stacks[key] < triggerStacks {
		return
	}
	amount, attrEvidence, ok := state.resolveOperationAmount(op, state.stacks[key])
	if !ok {
		return
	}
	if !state.applyDamage(timeMs, passiveDamageSource(passive, op), op.DamageType, amount).Applied {
		return
	}
	state.recordPassiveDamageBreakdown(timeMs, passive, op, amount, dpsOpTriggerDamageAtStacks, attrEvidence)
	if op.ResetStacks {
		delete(state.stacks, key)
		delete(state.stackExpiry, key)
	}
}

func (state *dpsCurveState) recordPassiveDamageBreakdown(
	timeMs int64,
	passive model.DPSPassiveEffectV2,
	op model.DPSPassiveOperationV2,
	amount float64,
	kind string,
	attrEvidence *dpsAttackerAttrEvidence,
) {
	state.result.EffectBreakdown = append(state.result.EffectBreakdown, model.DPSEffectBreakdownV2{
		TimeMs:  timeMs,
		Source:  passiveDamageSource(passive, op),
		Kind:    kind,
		Amount:  amount,
		Message: passiveDamageBreakdownMessage(op, attrEvidence),
	})
}

type dpsAttackerAttrEvidence struct {
	attrKey      string
	readKind     model.AttributeReadKind
	attrValue    float64
	ratio        float64
	contribution float64
}

func normalizeAttackerAttrRead(kind model.AttributeReadKind) model.AttributeReadKind {
	switch kind {
	case "", model.AttrReadResolved, "total":
		return model.AttrReadResolved
	default:
		return kind
	}
}

func (state *dpsCurveState) readAttackerAttrValue(attrKey string, readKind model.AttributeReadKind) (float64, bool) {
	attrKey = strings.TrimSpace(attrKey)
	if attrKey == "" {
		state.block("passive damage formula requires attackerAttr")
		return 0, false
	}
	kind := normalizeAttackerAttrRead(readKind)
	switch kind {
	case model.AttrReadResolved:
		value, ok := state.attrs[attrKey]
		if !ok || math.IsNaN(value) || math.IsInf(value, 0) {
			state.block("passive damage formula requires attacker attr " + attrKey)
			return 0, false
		}
		return value, true
	case model.AttrReadBase, model.AttrReadCurrent, model.AttrReadMax:
		view, ok := state.attributeViews[attrKey]
		if !ok {
			state.block("passive damage formula requires attacker attr view " + attrKey + " for read " + string(kind))
			return 0, false
		}
		var value float64
		switch kind {
		case model.AttrReadBase:
			value = view.Base
		case model.AttrReadCurrent:
			value = view.Current
		case model.AttrReadMax:
			value = view.Max
		}
		if math.IsNaN(value) || math.IsInf(value, 0) {
			state.block("passive damage formula requires valid attacker attr view " + attrKey + " for read " + string(kind))
			return 0, false
		}
		return value, true
	default:
		state.block("unsupported passive damage attackerAttrRead " + string(kind))
		return 0, false
	}
}

func passiveDamageBreakdownMessage(op model.DPSPassiveOperationV2, attrEvidence *dpsAttackerAttrEvidence) string {
	message := op.DamageType
	if attrEvidence == nil {
		return message
	}
	return message + " attackerAttr=" + attrEvidence.attrKey +
		" attackerAttrRead=" + string(attrEvidence.readKind) +
		" attrValue=" + floatToString(attrEvidence.attrValue) +
		" attackerAttrRatio=" + floatToString(attrEvidence.ratio) +
		" contribution=" + floatToString(attrEvidence.contribution)
}

func (state *dpsCurveState) resolveOperationAmount(op model.DPSPassiveOperationV2, stacks int) (float64, *dpsAttackerAttrEvidence, bool) {
	amount := op.Amount
	if op.TargetCurrentHPRatio != 0 {
		hpForCurrent := state.targetHP
		switch op.TargetCurrentHPBasis {
		case "", "current":
		case "attack_start":
			hpForCurrent = state.attackStartTargetHP
		default:
			state.block("unsupported target current hp basis " + op.TargetCurrentHPBasis)
			return 0, nil, false
		}
		if hpForCurrent < 0 {
			hpForCurrent = 0
		}
		amount += hpForCurrent * op.TargetCurrentHPRatio
	}
	if op.TargetMaxHPRatio != 0 {
		if state.targetMaxHP <= 0 {
			state.block("passive damage formula requires target max hp")
			return 0, nil, false
		}
		amount += state.targetMaxHP * op.TargetMaxHPRatio
	}
	if op.TargetMissingHPRatio != 0 {
		if state.targetMaxHP <= 0 {
			state.block("passive damage formula requires target max hp")
			return 0, nil, false
		}
		hpForMissing := state.targetHP
		switch op.TargetMissingHPBasis {
		case "", "current":
		case "attack_start":
			hpForMissing = state.attackStartTargetHP
		default:
			state.block("unsupported target missing hp basis " + op.TargetMissingHPBasis)
			return 0, nil, false
		}
		missingHP := state.targetMaxHP - hpForMissing
		if missingHP < 0 {
			missingHP = 0
		}
		amount += missingHP * op.TargetMissingHPRatio
	}
	if op.TargetMissingHPAmp != 0 {
		if state.targetMaxHP <= 0 {
			state.block("passive damage amp requires target max hp")
			return 0, nil, false
		}
		hpForMissing := state.targetHP
		switch op.TargetMissingHPBasis {
		case "", "current":
		case "attack_start":
			hpForMissing = state.attackStartTargetHP
		default:
			state.block("unsupported target missing hp basis " + op.TargetMissingHPBasis)
			return 0, nil, false
		}
		missingRatio := (state.targetMaxHP - hpForMissing) / state.targetMaxHP
		if missingRatio < 0 {
			missingRatio = 0
		}
		if missingRatio > 1 {
			missingRatio = 1
		}
		amount *= 1 + missingRatio*op.TargetMissingHPAmp
	}
	var attrEvidence *dpsAttackerAttrEvidence
	if op.AttackerAttrRatio != 0 {
		attrValue, ok := state.readAttackerAttrValue(op.AttackerAttr, op.AttackerAttrRead)
		if !ok {
			return 0, nil, false
		}
		contribution := attrValue * op.AttackerAttrRatio
		amount += contribution
		attrEvidence = &dpsAttackerAttrEvidence{
			attrKey:      op.AttackerAttr,
			readKind:     normalizeAttackerAttrRead(op.AttackerAttrRead),
			attrValue:    attrValue,
			ratio:        op.AttackerAttrRatio,
			contribution: contribution,
		}
	}
	if op.AmountPerStack != 0 {
		amount += float64(stacks) * op.AmountPerStack
	}
	if op.HasMinAmount && amount < op.MinAmount {
		amount = op.MinAmount
	}
	if amount < 0 || math.IsNaN(amount) || math.IsInf(amount, 0) {
		state.block("passive damage formula resolved invalid amount")
		return 0, nil, false
	}
	return amount, attrEvidence, true
}

func stackBreakdownMessage(stackKey string, before int, after int, maxStacks int, expireAt int64) string {
	message := "stackKey=" + stackKey + " before=" + intToString(before) + " after=" + intToString(after) + " maxStacks=" + intToString(maxStacks)
	if expireAt > 0 {
		message += " expireAtMs=" + int64ToString(expireAt)
	}
	return message
}

func statModifierBreakdownMessage(op model.DPSPassiveOperationV2, stacks int, targetRole string) string {
	mode := op.ModifierMode
	if mode == "" {
		mode = "flat"
	}
	message := "attrKey=" + op.AttrKey + " modifierMode=" + mode + " value=" + floatToString(op.Value)
	if targetRole != "" && targetRole != dpsRoleAttacker {
		message += " targetRole=" + targetRole
	}
	if op.PerStack {
		message += " perStack=true stackKey=" + op.StackKey + " stacks=" + intToString(stacks)
	}
	return message
}
