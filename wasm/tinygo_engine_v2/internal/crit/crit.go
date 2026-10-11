// 本文件提供概率边界与数值夹取，保留原始值、实际值和边界证据。
package crit

import "tinygo_engine_v2/internal/model"

type Bounds struct {
	Min    float64
	HasMin bool
	Max    float64
	HasMax bool
}

func ProbabilityBounds() Bounds {
	return Bounds{Min: 0, HasMin: true, Max: 1, HasMax: true}
}

func ClampValue(key string, source string, raw float64, bounds Bounds) (effective float64, evidence *model.NumericBoundEvidenceV2) {
	if bounds.HasMin && raw < bounds.Min {
		effective = bounds.Min
	} else if bounds.HasMax && raw > bounds.Max {
		effective = bounds.Max
	} else {
		effective = raw
	}
	wasClamped := effective != raw
	if !wasClamped && !bounds.HasMin && !bounds.HasMax {
		return effective, nil
	}
	evidence = &model.NumericBoundEvidenceV2{
		Key:          key,
		Source:       source,
		Mode:         "clamp",
		RawValue:     raw,
		BoundedValue: effective,
		Min:          bounds.Min,
		HasMin:       bounds.HasMin,
		Max:          bounds.Max,
		HasMax:       bounds.HasMax,
		WasClamped:   wasClamped,
	}
	return effective, evidence
}
