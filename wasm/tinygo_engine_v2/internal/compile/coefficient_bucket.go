package compile

import "tinygo_engine_v2/internal/model"

type ResolutionDomain uint8

const (
	ResolutionDomainAttribute ResolutionDomain = iota + 1
	ResolutionDomainHPChange
)

type AggregationMode uint8

const (
	AggregationModeAdd AggregationMode = iota + 1
	AggregationModeMultiply
	AggregationModePickMax
	AggregationModeSetFinal
)

type CompiledCoefficientBucketConfig struct {
	Priority        int
	ValueUnit       string
	ClampMin        float64
	HasClampMin     bool
	ClampMax        float64
	HasClampMax     bool
	EvidenceLabel   string
	LegacyBucketKey string
}

type CompiledCoefficientBucket struct {
	ID               uint16
	BucketKey        string
	ResolutionDomain ResolutionDomain
	StageKey         string
	TargetAttr       uint16
	HasTargetAttr    bool
	AggregationMode  AggregationMode
	Provisional      bool
	Name             string
	Description      string
	EditorHint       map[string]interface{}
	Config           CompiledCoefficientBucketConfig
}

func compileCoefficientBuckets(input []model.CoefficientBucketV2, cb CompiledBundle) ([]CompiledCoefficientBucket, map[string]uint16, []string) {
	if len(input) == 0 {
		return nil, nil, nil
	}
	buckets := make([]CompiledCoefficientBucket, 0, len(input))
	index := make(map[string]uint16, len(input))
	seen := make(map[string]struct{}, len(input))
	var problems []string
	for _, bucket := range input {
		key := bucket.BucketKey
		var bucketProblems []string

		if key == "" {
			bucketProblems = append(bucketProblems, "coefficient bucket key is empty")
		} else if _, exists := seen[key]; exists {
			bucketProblems = append(bucketProblems, "duplicate coefficient bucket: "+key)
		} else {
			seen[key] = struct{}{}
		}

		domain := resolutionDomain(bucket.ResolutionDomain)
		domainValid := domain != 0
		if !domainValid {
			bucketProblems = append(bucketProblems, "unsupported coefficient bucket resolution domain: "+key+"."+bucket.ResolutionDomain)
		}

		if domainValid {
			if bucket.StageKey == "" {
				bucketProblems = append(bucketProblems, "coefficient bucket stage key is empty: "+key)
			} else if !isAllowedStageKey(domain, bucket.StageKey) {
				bucketProblems = append(bucketProblems, "unsupported coefficient bucket stage key: "+key+"."+bucket.StageKey)
			}
		}

		mode := aggregationMode(bucket.AggregationMode)
		if mode == 0 {
			bucketProblems = append(bucketProblems, "unsupported coefficient bucket aggregation mode: "+key+"."+bucket.AggregationMode)
		}

		var targetAttr uint16
		hasTargetAttr := false
		if domainValid {
			switch domain {
			case ResolutionDomainAttribute:
				if bucket.TargetAttrKey == "" {
					bucketProblems = append(bucketProblems, "coefficient bucket missing target attr: "+key)
				} else if attrIdx, ok := cb.AttrIndex[bucket.TargetAttrKey]; !ok {
					bucketProblems = append(bucketProblems, "unknown coefficient bucket target attr: "+key+"."+bucket.TargetAttrKey)
				} else {
					targetAttr = attrIdx
					hasTargetAttr = true
				}
			case ResolutionDomainHPChange:
				if bucket.TargetAttrKey != "" {
					bucketProblems = append(bucketProblems, "coefficient bucket must not declare target attr for hp_change: "+key)
				}
			}
		}

		valueUnit := bucket.BucketConfig.ValueUnit
		if valueUnit != "" && !isAllowedValueUnit(valueUnit) {
			bucketProblems = append(bucketProblems, "unsupported coefficient bucket value unit: "+key+"."+valueUnit)
		}
		if mode == AggregationModeSetFinal && valueUnit != "final_value" {
			bucketProblems = append(bucketProblems, "coefficient bucket set_final requires valueUnit final_value: "+key)
		}

		if bucket.BucketConfig.HasClampMin && bucket.BucketConfig.HasClampMax &&
			bucket.BucketConfig.ClampMin > bucket.BucketConfig.ClampMax {
			bucketProblems = append(bucketProblems, "coefficient bucket clamp range invalid: "+key)
		}

		if len(bucketProblems) > 0 {
			problems = append(problems, bucketProblems...)
			continue
		}

		compiled := CompiledCoefficientBucket{
			ID:               uint16(len(buckets)),
			BucketKey:        key,
			ResolutionDomain: domain,
			StageKey:         bucket.StageKey,
			AggregationMode:  mode,
			Provisional:      bucket.Provisional,
			Name:             bucket.Name,
			Description:      bucket.Description,
			EditorHint:       copyEditorHint(bucket.EditorHint),
			TargetAttr:       targetAttr,
			HasTargetAttr:    hasTargetAttr,
			Config: CompiledCoefficientBucketConfig{
				Priority:        bucket.BucketConfig.Priority,
				ValueUnit:       bucket.BucketConfig.ValueUnit,
				ClampMin:        bucket.BucketConfig.ClampMin,
				HasClampMin:     bucket.BucketConfig.HasClampMin,
				ClampMax:        bucket.BucketConfig.ClampMax,
				HasClampMax:     bucket.BucketConfig.HasClampMax,
				EvidenceLabel:   bucket.BucketConfig.EvidenceLabel,
				LegacyBucketKey: bucket.BucketConfig.LegacyBucketKey,
			},
		}

		index[key] = compiled.ID
		buckets = append(buckets, compiled)
	}
	return buckets, index, problems
}

func resolutionDomain(value string) ResolutionDomain {
	switch value {
	case "attribute":
		return ResolutionDomainAttribute
	case "hp_change":
		return ResolutionDomainHPChange
	default:
		return 0
	}
}

func aggregationMode(value string) AggregationMode {
	switch value {
	case "add":
		return AggregationModeAdd
	case "multiply":
		return AggregationModeMultiply
	case "pick_max":
		return AggregationModePickMax
	case "set_final":
		return AggregationModeSetFinal
	default:
		return 0
	}
}

func isAllowedStageKey(domain ResolutionDomain, stageKey string) bool {
	switch domain {
	case ResolutionDomainAttribute:
		switch stageKey {
		case "attribute/base_bonus", "attribute/flat_bonus", "attribute/final_multiplier":
			return true
		}
	case ResolutionDomainHPChange:
		switch stageKey {
		case "hp_change/outgoing/pre_mitigation", "hp_change/incoming/pre_mitigation",
			"hp_change/final/post_mitigation", "hp_change/flat/post_percent":
			return true
		}
	}
	return false
}

func isAllowedValueUnit(valueUnit string) bool {
	switch valueUnit {
	case "percent_delta", "factor", "flat_delta", "final_value":
		return true
	default:
		return false
	}
}

func copyEditorHint(input map[string]interface{}) map[string]interface{} {
	if len(input) == 0 {
		return nil
	}
	output := make(map[string]interface{}, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}
