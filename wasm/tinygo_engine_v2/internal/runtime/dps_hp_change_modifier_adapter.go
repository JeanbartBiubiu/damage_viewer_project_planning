// HP change coefficient bucket adapter for combat damage_modifier operations.
package runtime

import (
	"math"
	"sort"
	"strings"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

type dpsHPChangeBucketCandidate struct {
	passive model.DPSPassiveEffectV2
	op      model.DPSPassiveOperationV2
	value   float64
	bucket  compilebundle.CompiledCoefficientBucket
}

type dpsHPChangeBucketGroup struct {
	bucket  compilebundle.CompiledCoefficientBucket
	applied []dpsHPChangeBucketCandidate
	skipped []dpsCoefficientBucketSkippedCandidate
}

func (state *dpsCurveState) buildModifierGateContext(ctx dpsCombatEventContext) dpsModifierGateContext {
	attackerMaxHP := state.attacker.MaxHP
	if attackerMaxHP <= 0 {
		attackerMaxHP = readFirstPositiveAttr(state.attacker.Attributes, "hp", "health", "max_hp", "max_health")
	}
	attackerHP := state.attacker.CurrentHP
	if attackerHP <= 0 {
		attackerHP = attackerMaxHP
	}
	if state.runCtx != nil {
		attackerHP = state.runCtx.Actors[state.attackerIdx].HP
		if attackerMaxHP <= 0 {
			attackerMaxHP = state.runCtx.Actors[state.attackerIdx].MaxHP
		}
	}
	return dpsModifierGateContext{
		DamageType:     ctx.DamageType,
		ActionTypes:    ctx.ActionTypes,
		ProcScope:      ctx.ProcScope,
		HasCritContext: ctx.HasCritContext,
		IsCrit:         ctx.IsCrit,
		AttackerHP:     attackerHP,
		AttackerMaxHP:  attackerMaxHP,
		TargetHP:       state.targetHP,
		TargetMaxHP:    state.targetMaxHP,
		AttackerAttrs:  state.attrs,
		TargetAttrs:    state.targetAttrs,
		AttackerViews:  state.attributeViews,
	}
}

func (state *dpsCurveState) collectHPChangeBucketModifierEntries(ctx dpsCombatEventContext) []dpsIncomingDamageModifierEntry {
	entries := make([]dpsIncomingDamageModifierEntry, 0)
	for index, passive := range state.passives {
		if !state.linkedPassiveMatchesEvent(ctx, passive) {
			continue
		}
		triggerKind := resolvedDPSTriggerKind(passive)
		if triggerKind == dpsTriggerStatAlwaysOn || triggerKind == dpsTriggerPreEnabledModifier {
			continue
		}
		if triggerKind == dpsTriggerEnergizedChargeAndConsume || triggerKind == dpsTriggerNextBasicAttackAfterState {
			continue
		}
		if !state.passiveActiveAt(passive, ctx.TimeMs) {
			continue
		}
		if triggerKind == dpsTriggerEveryNBasicAttack {
			key := passiveRuntimeKey(passive)
			everyN := passive.EveryN
			if everyN <= 0 {
				everyN = 1
			}
			if state.hitCounts[key]%everyN != 0 {
				continue
			}
		}
		for opIndex, op := range passive.Operations {
			if !dpsOperationUsesHPChangeBucket(state.bundle, op) {
				continue
			}
			entries = append(entries, dpsIncomingDamageModifierEntry{
				originalIndex:  index,
				operationIndex: opIndex,
				passive:        passive,
				op:             op,
			})
		}
	}
	sort.SliceStable(entries, func(i, j int) bool {
		leftPriority := resolvedDPSPassivePriority(entries[i].passive)
		rightPriority := resolvedDPSPassivePriority(entries[j].passive)
		if leftPriority != rightPriority {
			return leftPriority < rightPriority
		}
		if entries[i].originalIndex != entries[j].originalIndex {
			return entries[i].originalIndex < entries[j].originalIndex
		}
		return entries[i].operationIndex < entries[j].operationIndex
	})
	return entries
}

func (state *dpsCurveState) resolveHPChangeBucketCandidates(
	ctx dpsCombatEventContext,
	stageKey string,
	entries []dpsIncomingDamageModifierEntry,
	gate dpsModifierGateContext,
) ([]dpsHPChangeBucketGroup, bool) {
	byBucket := map[uint16]*dpsHPChangeBucketGroup{}
	for _, entry := range entries {
		op := entry.op
		bucketKey := strings.TrimSpace(op.BucketKey)
		bucketID, ok := state.bundle.CoefficientBucketIndex[bucketKey]
		if !ok || int(bucketID) >= len(state.bundle.CoefficientBuckets) {
			state.block("passive damage_modifier references unknown coefficient bucket " + bucketKey)
			return nil, false
		}
		bucket := state.bundle.CoefficientBuckets[bucketID]
		if bucket.ResolutionDomain != compilebundle.ResolutionDomainHPChange {
			state.block("passive " + op.Kind + " coefficient bucket " + bucketKey + " is not hp_change domain")
			return nil, false
		}
		if bucket.StageKey != stageKey {
			continue
		}
		targetRole := resolvedDPSBucketModifierTargetRole(op, bucket)
		if stageKey == dpsHPChangeStageOutgoingPreMitigation {
			if targetRole != dpsRoleAttacker {
				state.block("passive damage_modifier outgoing bucket requires targetRole attacker")
				return nil, false
			}
		} else if targetRole != dpsRoleTarget {
			state.block("passive damage_modifier hp_change bucket requires targetRole target")
			return nil, false
		}
		group := byBucket[bucketID]
		if group == nil {
			group = &dpsHPChangeBucketGroup{bucket: bucket}
			byBucket[bucketID] = group
		}
		ok, reason := evaluateDPSModifierConditions(op.Conditions, gate)
		if !ok {
			if reason != "" {
				state.block(reason)
				return nil, false
			}
			group.skipped = append(group.skipped, dpsCoefficientBucketSkippedCandidate{
				passive:    entry.passive,
				op:         op,
				bucket:     bucket,
				skipReason: describeDPSModifierConditionSkipReason(op.Conditions, gate),
			})
			continue
		}
		if op.CritOnly && !ctx.HasCritContext {
			state.block("passive damage_modifier critOnly requires crit context")
			return nil, false
		}
		value, ok, reason := resolveDPSModifierValue(state.bundle, op, gate)
		if !ok {
			if reason != "" {
				state.block(reason)
			} else {
				state.block("passive damage_modifier could not resolve bucket value")
			}
			return nil, false
		}
		group.applied = append(group.applied, dpsHPChangeBucketCandidate{
			passive: entry.passive,
			op:      op,
			value:   value,
			bucket:  bucket,
		})
	}
	if len(byBucket) == 0 {
		return nil, true
	}
	bucketIDs := make([]uint16, 0, len(byBucket))
	for bucketID := range byBucket {
		bucketIDs = append(bucketIDs, bucketID)
	}
	sort.Slice(bucketIDs, func(i, j int) bool {
		leftBucket := state.bundle.CoefficientBuckets[bucketIDs[i]]
		rightBucket := state.bundle.CoefficientBuckets[bucketIDs[j]]
		if leftBucket.Config.Priority != rightBucket.Config.Priority {
			return leftBucket.Config.Priority < rightBucket.Config.Priority
		}
		return bucketIDs[i] < bucketIDs[j]
	})
	groups := make([]dpsHPChangeBucketGroup, 0, len(bucketIDs))
	for _, bucketID := range bucketIDs {
		group := byBucket[bucketID]
		if len(group.applied) == 0 && len(group.skipped) == 0 {
			continue
		}
		groups = append(groups, *group)
	}
	return groups, true
}

func hpChangeBucketCandidateEvidence(
	group dpsHPChangeBucketGroup,
) (applied []model.DPSCoefficientBucketCandidateEvidenceV2, skipped []model.DPSCoefficientBucketCandidateEvidenceV2) {
	applied = make([]model.DPSCoefficientBucketCandidateEvidenceV2, 0, len(group.applied))
	for _, candidate := range group.applied {
		applied = append(applied, buildCoefficientBucketCandidateEvidence(
			candidate.passive, candidate.op, candidate.value, true, "",
		))
	}
	skipped = make([]model.DPSCoefficientBucketCandidateEvidenceV2, 0, len(group.skipped))
	for _, candidate := range group.skipped {
		skipped = append(skipped, buildCoefficientBucketCandidateEvidence(
			candidate.passive, candidate.op, 0, false, candidate.skipReason,
		))
	}
	return applied, skipped
}

func hpChangeBucketEffectSource(group dpsHPChangeBucketGroup) (passive model.DPSPassiveEffectV2, op model.DPSPassiveOperationV2) {
	if len(group.applied) > 0 {
		return group.applied[0].passive, group.applied[0].op
	}
	return group.skipped[0].passive, group.skipped[0].op
}

func (state *dpsCurveState) applyHPChangeStageBuckets(
	ctx dpsCombatEventContext,
	stageKey string,
	amount float64,
	entries []dpsIncomingDamageModifierEntry,
	gate dpsModifierGateContext,
	triggered map[string]bool,
) (float64, bool) {
	groups, ok := state.resolveHPChangeBucketCandidates(ctx, stageKey, entries, gate)
	if !ok {
		return 0, false
	}
	if len(groups) == 0 {
		return amount, true
	}
	current := amount
	for _, group := range groups {
		bucket := group.bucket
		appliedEvidence, skippedEvidence := hpChangeBucketCandidateEvidence(group)
		passive, op := hpChangeBucketEffectSource(group)
		source := passiveDamageSource(passive, op)
		if len(group.applied) == 0 {
			appendCoefficientBucketEffectBreakdown(
				state, ctx.TimeMs, source, 0,
				"hp_change", stageKey, bucket, current, current,
				nil, skippedEvidence,
			)
			continue
		}
		sortDPSHPChangeBucketCandidatesByOperationPriority(group.applied)
		values := make([]float64, 0, len(group.applied))
		appliedPassives := map[string]bool{}
		for _, candidate := range group.applied {
			values = append(values, candidate.value)
			appliedPassives[passiveRuntimeKey(candidate.passive)] = true
		}
		aggregate, hasAggregate, reason := aggregateCoefficientBucketValues(bucket, values)
		if !hasAggregate {
			if reason != "" {
				state.block(reason)
			}
			return 0, false
		}
		raw := current
		modified, ok, reason := applyCoefficientBucketAggregate(current, bucket, aggregate)
		if !ok {
			if reason != "" {
				state.block(reason)
			}
			return 0, false
		}
		modified = clampCoefficientBucketAmount(modified, bucket)
		if !validateCoefficientBucketFinite(modified) {
			state.block("passive damage_modifier coefficient bucket resolved invalid amount")
			return 0, false
		}
		for runtimeKey := range appliedPassives {
			if triggered[runtimeKey] {
				continue
			}
			for _, candidate := range group.applied {
				if passiveRuntimeKey(candidate.passive) != runtimeKey {
					continue
				}
				state.recordPassiveTrigger(ctx.TimeMs, candidate.passive)
				triggered[runtimeKey] = true
				break
			}
		}
		appendCoefficientBucketEffectBreakdown(
			state, ctx.TimeMs, source, modified-raw,
			"hp_change", stageKey, bucket, raw, modified,
			appliedEvidence, skippedEvidence,
		)
		current = modified
	}
	return current, true
}

func (state *dpsCurveState) resolveCombatDamageAmount(
	ctx dpsCombatEventContext,
	damageType string,
	amount float64,
) (preMitigationAmount float64, finalAmount float64, ok bool) {
	if amount < 0 || math.IsNaN(amount) || math.IsInf(amount, 0) {
		state.block("hp_change coefficient bucket requires valid raw amount")
		return 0, 0, false
	}
	incomingCtx := ctx
	outgoingCtx := ctx
	outgoingCtx.Event = dpsEventOnDamageDealt
	incomingEntries := state.collectHPChangeBucketModifierEntries(incomingCtx)
	outgoingEntries := state.collectHPChangeBucketModifierEntries(outgoingCtx)
	gate := state.buildModifierGateContext(ctx)
	triggered := map[string]bool{}

	current := amount
	next, stageOK := state.applyHPChangeStageBuckets(outgoingCtx, dpsHPChangeStageOutgoingPreMitigation, current, outgoingEntries, gate, triggered)
	if !stageOK {
		return 0, 0, false
	}
	current = next
	next, stageOK = state.applyHPChangeStageBuckets(incomingCtx, dpsHPChangeStageIncomingPreMitigation, current, incomingEntries, gate, triggered)
	if !stageOK {
		return 0, 0, false
	}
	current = next
	preMitigationAmount = current

	resistance := 0.0
	switch damageType {
	case "physical":
		resistance = state.armor
	case "magic":
		resistance = state.magicResist
	case "true":
	default:
		state.block("unsupported damage type " + damageType)
		return 0, 0, false
	}
	resistance = state.effectiveResistance(damageType, resistance)
	mitigatedDamage, code := mitigateDamageByResistance(current, resistance, damageType)
	if code != model.ErrOK {
		state.block("damage could not be resolved")
		return 0, 0, false
	}
	current = mitigatedDamage

	next, stageOK = state.applyHPChangeStageBuckets(incomingCtx, dpsHPChangeStageFinalPostMitigation, current, incomingEntries, gate, triggered)
	if !stageOK {
		return 0, 0, false
	}
	current = next
	next, stageOK = state.applyHPChangeStageBuckets(incomingCtx, dpsHPChangeStageFlatPostPercent, current, incomingEntries, gate, triggered)
	if !stageOK {
		return 0, 0, false
	}
	current = next
	if current < 0 {
		current = 0
	}
	return preMitigationAmount, current, true
}
