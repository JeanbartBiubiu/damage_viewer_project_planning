// Coefficient bucket aggregation for hp_change and attribute domains.
package runtime

import (
	"math"
	"sort"
	"strings"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func aggregateCoefficientBucketValues(
	bucket compilebundle.CompiledCoefficientBucket,
	values []float64,
) (float64, bool, string) {
	if len(values) == 0 {
		return 0, false, ""
	}
	valueUnit := strings.TrimSpace(bucket.Config.ValueUnit)
	switch bucket.AggregationMode {
	case compilebundle.AggregationModeAdd:
		switch valueUnit {
		case "percent_delta", "flat_delta":
			sum := 0.0
			for _, value := range values {
				sum += value
			}
			return sum, true, ""
		default:
			return 0, false, "coefficient bucket add aggregation has unsupported valueUnit " + valueUnit
		}
	case compilebundle.AggregationModeMultiply:
		if valueUnit != "factor" {
			return 0, false, "coefficient bucket multiply aggregation requires valueUnit factor"
		}
		product := 1.0
		for _, value := range values {
			product *= value
		}
		return product, true, ""
	case compilebundle.AggregationModeSetFinal:
		if valueUnit != "final_value" {
			return 0, false, "coefficient bucket set_final aggregation requires valueUnit final_value"
		}
		return values[len(values)-1], true, ""
	case compilebundle.AggregationModePickMax:
		switch valueUnit {
		case "percent_delta", "factor", "flat_delta", "final_value":
			maxValue := values[0]
			for _, value := range values[1:] {
				if value > maxValue {
					maxValue = value
				}
			}
			return maxValue, true, ""
		default:
			return 0, false, "coefficient bucket pick_max aggregation has unsupported valueUnit " + valueUnit
		}
	default:
		return 0, false, "coefficient bucket has unsupported aggregation mode"
	}
}

func applyCoefficientBucketAggregate(
	amount float64,
	bucket compilebundle.CompiledCoefficientBucket,
	aggregate float64,
) (float64, bool, string) {
	valueUnit := strings.TrimSpace(bucket.Config.ValueUnit)
	switch bucket.AggregationMode {
	case compilebundle.AggregationModeAdd:
		switch valueUnit {
		case "percent_delta":
			return amount * (1 + aggregate), true, ""
		case "flat_delta":
			return amount + aggregate, true, ""
		default:
			return 0, false, "coefficient bucket add aggregation has unsupported valueUnit " + valueUnit
		}
	case compilebundle.AggregationModeMultiply:
		return amount * aggregate, true, ""
	case compilebundle.AggregationModeSetFinal:
		return aggregate, true, ""
	case compilebundle.AggregationModePickMax:
		switch valueUnit {
		case "percent_delta":
			return amount * (1 + aggregate), true, ""
		case "factor":
			return amount * aggregate, true, ""
		case "flat_delta":
			return amount + aggregate, true, ""
		case "final_value":
			return aggregate, true, ""
		default:
			return 0, false, "coefficient bucket pick_max aggregation has unsupported valueUnit " + valueUnit
		}
	default:
		return 0, false, "coefficient bucket has unsupported aggregation mode"
	}
}

func clampCoefficientBucketAmount(amount float64, bucket compilebundle.CompiledCoefficientBucket) float64 {
	if bucket.Config.HasClampMin && amount < bucket.Config.ClampMin {
		amount = bucket.Config.ClampMin
	}
	if bucket.Config.HasClampMax && amount > bucket.Config.ClampMax {
		amount = bucket.Config.ClampMax
	}
	return amount
}

func validateCoefficientBucketFinite(amount float64) bool {
	return !math.IsNaN(amount) && !math.IsInf(amount, 0)
}

func coefficientBucketAggregationModeName(mode compilebundle.AggregationMode) string {
	switch mode {
	case compilebundle.AggregationModeAdd:
		return "add"
	case compilebundle.AggregationModeMultiply:
		return "multiply"
	case compilebundle.AggregationModePickMax:
		return "pick_max"
	case compilebundle.AggregationModeSetFinal:
		return "set_final"
	default:
		return ""
	}
}

func coefficientBucketEvidenceMessage(
	domain string,
	stageKey string,
	bucket compilebundle.CompiledCoefficientBucket,
	raw float64,
	result float64,
	evidenceKeys []string,
) string {
	message := "domain=" + domain +
		" stageKey=" + stageKey +
		" bucketKey=" + bucket.BucketKey +
		" aggregationMode=" + coefficientBucketAggregationModeName(bucket.AggregationMode) +
		" valueUnit=" + strings.TrimSpace(bucket.Config.ValueUnit) +
		" raw=" + floatToString(raw) +
		" result=" + floatToString(result)
	if evidenceKeySuffix := formatCoefficientBucketEvidenceKeys(evidenceKeys); evidenceKeySuffix != "" {
		message += evidenceKeySuffix
	}
	return message
}

func sortCoefficientBucketGroupByOperationPriority[T any](group []T, priority func(T) int) {
	sort.SliceStable(group, func(i, j int) bool {
		return priority(group[i]) < priority(group[j])
	})
}

func sortDPSAttributeBucketCandidatesByOperationPriority(group []dpsAttributeBucketCandidate) {
	sortCoefficientBucketGroupByOperationPriority(group, func(candidate dpsAttributeBucketCandidate) int {
		return resolvedDPSOperationPriority(candidate.op)
	})
}

func sortDPSHPChangeBucketCandidatesByOperationPriority(group []dpsHPChangeBucketCandidate) {
	sortCoefficientBucketGroupByOperationPriority(group, func(candidate dpsHPChangeBucketCandidate) int {
		return resolvedDPSOperationPriority(candidate.op)
	})
}

func collectDPSOperationEvidenceKeys(ops []model.DPSPassiveOperationV2) []string {
	keys := make([]string, 0, len(ops))
	for _, op := range ops {
		keys = append(keys, op.EvidenceKey)
	}
	return keys
}

func lookupDPSCoefficientBucket(bundle compilebundle.CompiledBundle, bucketKey string) (compilebundle.CompiledCoefficientBucket, bool) {
	bucketID, ok := bundle.CoefficientBucketIndex[bucketKey]
	if !ok || int(bucketID) >= len(bundle.CoefficientBuckets) {
		return compilebundle.CompiledCoefficientBucket{}, false
	}
	return bundle.CoefficientBuckets[bucketID], true
}

func dpsOperationUsesAttributeBucket(bundle compilebundle.CompiledBundle, op model.DPSPassiveOperationV2) bool {
	bucketKey := strings.TrimSpace(op.BucketKey)
	if bucketKey == "" {
		return false
	}
	switch op.Kind {
	case dpsOpStatModifier:
		return true
	case dpsOpCoefficientModifier:
		bucket, ok := lookupDPSCoefficientBucket(bundle, bucketKey)
		return ok && bucket.ResolutionDomain == compilebundle.ResolutionDomainAttribute
	default:
		return false
	}
}

func dpsOperationUsesHPChangeBucket(bundle compilebundle.CompiledBundle, op model.DPSPassiveOperationV2) bool {
	bucketKey := strings.TrimSpace(op.BucketKey)
	if bucketKey == "" {
		return false
	}
	switch op.Kind {
	case dpsOpDamageModifier:
		return true
	case dpsOpCoefficientModifier:
		bucket, ok := lookupDPSCoefficientBucket(bundle, bucketKey)
		return ok && bucket.ResolutionDomain == compilebundle.ResolutionDomainHPChange
	default:
		return false
	}
}

func resolvedDPSBucketModifierTargetRole(op model.DPSPassiveOperationV2, bucket compilebundle.CompiledCoefficientBucket) string {
	role := strings.TrimSpace(op.TargetRole)
	switch op.Kind {
	case dpsOpStatModifier:
		if role == "" {
			return dpsRoleAttacker
		}
		return role
	case dpsOpDamageModifier:
		if role == "" {
			return dpsRoleTarget
		}
		return role
	case dpsOpCoefficientModifier:
		if bucket.ResolutionDomain == compilebundle.ResolutionDomainAttribute {
			if role == "" {
				return dpsRoleAttacker
			}
			return role
		}
		if bucket.StageKey == dpsHPChangeStageOutgoingPreMitigation {
			if role == "" {
				return dpsRoleAttacker
			}
			return role
		}
		if role == "" {
			return dpsRoleTarget
		}
		return role
	default:
		if role == "" {
			return dpsRoleAttacker
		}
		return role
	}
}

func passiveOnlyHPChangeModifierOperations(bundle compilebundle.CompiledBundle, passive model.DPSPassiveEffectV2) bool {
	if len(passive.Operations) == 0 {
		return false
	}
	for _, op := range passive.Operations {
		if dpsOperationUsesHPChangeBucket(bundle, op) {
			continue
		}
		if op.Kind == dpsOpDamageModifier {
			continue
		}
		return false
	}
	return true
}

type dpsCoefficientBucketSkippedCandidate struct {
	passive    model.DPSPassiveEffectV2
	op         model.DPSPassiveOperationV2
	bucket     compilebundle.CompiledCoefficientBucket
	skipReason string
}

func describeDPSModifierConditionSkipReason(conditions []model.DPSModifierConditionV2, gate dpsModifierGateContext) string {
	for _, condition := range conditions {
		ok, reason := evaluateDPSModifierCondition(condition, gate)
		if !ok {
			if reason != "" {
				return reason
			}
			return formatDPSModifierConditionSkipReason(condition)
		}
	}
	return "condition_not_met"
}

func formatDPSModifierConditionSkipReason(condition model.DPSModifierConditionV2) string {
	metric := strings.TrimSpace(condition.Metric)
	if metric == "" {
		return "condition_not_met"
	}
	return "condition_not_met:" + metric
}

func buildCoefficientBucketCandidateEvidence(
	passive model.DPSPassiveEffectV2,
	op model.DPSPassiveOperationV2,
	value float64,
	applied bool,
	skipReason string,
) model.DPSCoefficientBucketCandidateEvidenceV2 {
	evidence := model.DPSCoefficientBucketCandidateEvidenceV2{
		Source:        passiveDamageSource(passive, op),
		SourceType:    strings.TrimSpace(passive.SourceType),
		PassiveID:     passiveID(passive),
		OperationKind: strings.TrimSpace(op.Kind),
		Value:         value,
		Priority:      resolvedDPSOperationPriority(op),
		EvidenceKey:   strings.TrimSpace(op.EvidenceKey),
		Applied:       applied,
		SkipReason:    skipReason,
	}
	return evidence
}

func buildCoefficientBucketEvidence(
	domain string,
	stageKey string,
	bucket compilebundle.CompiledCoefficientBucket,
	raw float64,
	result float64,
	applied []model.DPSCoefficientBucketCandidateEvidenceV2,
	skipped []model.DPSCoefficientBucketCandidateEvidenceV2,
) model.DPSCoefficientBucketEvidenceV2 {
	evidenceKeys := make([]string, 0, len(applied))
	for _, candidate := range applied {
		if key := strings.TrimSpace(candidate.EvidenceKey); key != "" {
			evidenceKeys = append(evidenceKeys, key)
		}
	}
	return model.DPSCoefficientBucketEvidenceV2{
		Domain:          domain,
		StageKey:        stageKey,
		BucketKey:       bucket.BucketKey,
		AggregationMode: coefficientBucketAggregationModeName(bucket.AggregationMode),
		ValueUnit:       strings.TrimSpace(bucket.Config.ValueUnit),
		Raw:             raw,
		Result:          result,
		EvidenceKeys:    dedupeCoefficientBucketEvidenceKeys(evidenceKeys),
		Candidates:      applied,
		Skipped:         skipped,
	}
}

func dedupeCoefficientBucketEvidenceKeys(evidenceKeys []string) []string {
	if len(evidenceKeys) == 0 {
		return nil
	}
	seen := map[string]bool{}
	ordered := make([]string, 0, len(evidenceKeys))
	for _, key := range evidenceKeys {
		key = strings.TrimSpace(key)
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		ordered = append(ordered, key)
	}
	if len(ordered) == 0 {
		return nil
	}
	return ordered
}

func appendCoefficientBucketEffectBreakdown(
	state *dpsCurveState,
	timeMs int64,
	source string,
	amount float64,
	domain string,
	stageKey string,
	bucket compilebundle.CompiledCoefficientBucket,
	raw float64,
	result float64,
	applied []model.DPSCoefficientBucketCandidateEvidenceV2,
	skipped []model.DPSCoefficientBucketCandidateEvidenceV2,
) {
	evidence := buildCoefficientBucketEvidence(domain, stageKey, bucket, raw, result, applied, skipped)
	evidenceKeys := make([]string, 0, len(applied))
	for _, candidate := range applied {
		evidenceKeys = append(evidenceKeys, candidate.EvidenceKey)
	}
	state.result.EffectBreakdown = append(state.result.EffectBreakdown, model.DPSEffectBreakdownV2{
		TimeMs:            timeMs,
		Source:            source,
		Kind:              dpsEffectCoefficientBucket,
		Amount:            amount,
		Message:           coefficientBucketEvidenceMessage(domain, stageKey, bucket, raw, result, evidenceKeys),
		CoefficientBucket: &evidence,
	})
}

func formatCoefficientBucketEvidenceKeys(evidenceKeys []string) string {
	if len(evidenceKeys) == 0 {
		return ""
	}
	seen := map[string]bool{}
	ordered := make([]string, 0, len(evidenceKeys))
	for _, key := range evidenceKeys {
		key = strings.TrimSpace(key)
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		ordered = append(ordered, key)
	}
	if len(ordered) == 0 {
		return ""
	}
	return " evidenceKey=" + strings.Join(ordered, ",")
}
