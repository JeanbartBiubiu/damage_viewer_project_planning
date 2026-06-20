// Attribute coefficient bucket adapter for DPS stat_modifier operations.
package runtime

import (
	"math"
	"sort"
	"strings"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

var dpsAttributeStageOrder = []string{
	dpsAttributeStageBaseBonus,
	dpsAttributeStageFlatBonus,
	dpsAttributeStageFinalMultiplier,
}

type dpsAttributeBucketGroup struct {
	bucket  compilebundle.CompiledCoefficientBucket
	applied []dpsAttributeBucketCandidate
	skipped []dpsCoefficientBucketSkippedCandidate
}

func (state *dpsCurveState) compiledBucketTargetAttrKey(bucket compilebundle.CompiledCoefficientBucket) (string, bool) {
	if !bucket.HasTargetAttr || int(bucket.TargetAttr) >= len(state.bundle.Attrs) {
		return "", false
	}
	key := strings.TrimSpace(state.bundle.Attrs[bucket.TargetAttr].ID)
	return key, key != ""
}

func (state *dpsCurveState) attributeBucketAttrMap(targetRole string) map[string]float64 {
	if targetRole == dpsRoleTarget {
		return state.targetAttrs
	}
	return state.attrs
}

func (state *dpsCurveState) resolveAttributeBucketCandidates(
	stageKey string,
	entries []dpsAttributeStatModifierEntry,
	gate dpsModifierGateContext,
) ([]dpsAttributeBucketGroup, bool) {
	byBucket := map[uint16]*dpsAttributeBucketGroup{}
	for _, entry := range entries {
		op := entry.op
		bucketKey := strings.TrimSpace(op.BucketKey)
		bucketID, ok := state.bundle.CoefficientBucketIndex[bucketKey]
		if !ok || int(bucketID) >= len(state.bundle.CoefficientBuckets) {
			state.block("passive stat_modifier references unknown coefficient bucket " + bucketKey)
			return nil, false
		}
		bucket := state.bundle.CoefficientBuckets[bucketID]
		if bucket.ResolutionDomain != compilebundle.ResolutionDomainAttribute {
			state.block("passive " + op.Kind + " coefficient bucket " + bucketKey + " is not attribute domain")
			return nil, false
		}
		if bucket.StageKey != stageKey {
			continue
		}
		targetAttrKey, ok := state.compiledBucketTargetAttrKey(bucket)
		if !ok {
			state.block("passive stat_modifier coefficient bucket " + bucketKey + " has invalid target attr")
			return nil, false
		}
		targetRole := resolvedDPSBucketModifierTargetRole(op, bucket)
		attrMap := state.attributeBucketAttrMap(targetRole)
		current, ok := attrMap[targetAttrKey]
		if !ok || math.IsNaN(current) || math.IsInf(current, 0) {
			state.block("passive stat_modifier coefficient bucket requires existing attr " + targetAttrKey)
			return nil, false
		}
		group := byBucket[bucketID]
		if group == nil {
			group = &dpsAttributeBucketGroup{bucket: bucket}
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
		value, ok, reason := resolveDPSModifierValue(state.bundle, op, gate, nil)
		if !ok {
			if reason != "" {
				state.block(reason)
			} else {
				state.block("passive stat_modifier could not resolve bucket value")
			}
			return nil, false
		}
		if op.PerStack {
			if op.StackKey == "" {
				state.block("passive perStack stat_modifier operation requires stackKey")
				return nil, false
			}
			stacks := state.stacks[stackRuntimeKey(entry.passive, op.StackKey)]
			if stacks <= 0 {
				continue
			}
			value *= float64(stacks)
		}
		group.applied = append(group.applied, dpsAttributeBucketCandidate{
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
	groups := make([]dpsAttributeBucketGroup, 0, len(bucketIDs))
	for _, bucketID := range bucketIDs {
		group := byBucket[bucketID]
		if len(group.applied) == 0 && len(group.skipped) == 0 {
			continue
		}
		groups = append(groups, *group)
	}
	return groups, true
}

func attributeBucketCandidateEvidence(
	group dpsAttributeBucketGroup,
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

func attributeBucketEffectSource(group dpsAttributeBucketGroup) (passive model.DPSPassiveEffectV2, op model.DPSPassiveOperationV2) {
	if len(group.applied) > 0 {
		return group.applied[0].passive, group.applied[0].op
	}
	return group.skipped[0].passive, group.skipped[0].op
}

func (state *dpsCurveState) applyAttributeStageBuckets(
	timeMs int64,
	stageKey string,
	entries []dpsAttributeStatModifierEntry,
	gate dpsModifierGateContext,
) bool {
	groups, ok := state.resolveAttributeBucketCandidates(stageKey, entries, gate)
	if !ok {
		return false
	}
	if len(groups) == 0 {
		return true
	}
	for _, group := range groups {
		bucket := group.bucket
		appliedEvidence, skippedEvidence := attributeBucketCandidateEvidence(group)
		passive, op := attributeBucketEffectSource(group)
		source := passiveDamageSource(passive, op)
		targetAttrKey, ok := state.compiledBucketTargetAttrKey(bucket)
		if !ok {
			state.block("passive stat_modifier coefficient bucket has invalid target attr")
			return false
		}
		targetRole := resolvedDPSBucketModifierTargetRole(op, bucket)
		attrMap := state.attributeBucketAttrMap(targetRole)
		current, ok := attrMap[targetAttrKey]
		if !ok || math.IsNaN(current) || math.IsInf(current, 0) {
			state.block("passive stat_modifier coefficient bucket requires existing attr " + targetAttrKey)
			return false
		}
		if len(group.applied) == 0 {
			appendCoefficientBucketEffectBreakdown(
				state, timeMs, source, 0,
				"attribute", stageKey, bucket, current, current,
				nil, skippedEvidence,
			)
			continue
		}
		sortDPSAttributeBucketCandidatesByOperationPriority(group.applied)
		values := make([]float64, 0, len(group.applied))
		for _, candidate := range group.applied {
			values = append(values, candidate.value)
		}
		aggregate, hasAggregate, reason := aggregateCoefficientBucketValues(bucket, values)
		if !hasAggregate {
			if reason != "" {
				state.block(reason)
			}
			return false
		}
		raw := current
		modified, ok, reason := applyCoefficientBucketAggregate(current, bucket, aggregate)
		if !ok {
			if reason != "" {
				state.block(reason)
			}
			return false
		}
		modified = clampCoefficientBucketAmount(modified, bucket)
		modified = state.boundDPSAttrValue(targetAttrKey, modified)
		if !validateCoefficientBucketFinite(modified) {
			state.block("passive stat_modifier coefficient bucket resolved invalid attr value")
			return false
		}
		attrMap[targetAttrKey] = modified
		if targetRole == dpsRoleTarget {
			state.syncTargetResistancesFromAttrs()
		}
		appendCoefficientBucketEffectBreakdown(
			state, timeMs, source, modified-raw,
			"attribute", stageKey, bucket, raw, modified,
			appliedEvidence, skippedEvidence,
		)
	}
	return true
}

func (state *dpsCurveState) applyAttributeCoefficientBuckets(
	timeMs int64,
	entries []dpsAttributeStatModifierEntry,
	gate dpsModifierGateContext,
) bool {
	for _, stageKey := range dpsAttributeStageOrder {
		if !state.applyAttributeStageBuckets(timeMs, stageKey, entries, gate) {
			return false
		}
	}
	return true
}
