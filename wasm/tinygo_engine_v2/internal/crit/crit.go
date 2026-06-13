// 本文件定义暴击策略骨架，负责 execution 级暴击结果和 scalar 复用的基础表达。
package crit

import "tinygo_engine_v2/internal/model"

type Policy uint8

const (
	PolicyNever Policy = iota
	PolicyDeterministic
	PolicyExpected
	PolicySeededRandom
)

type Spec struct {
	Policy     Policy
	Chance     float64
	Multiplier float64
}

type Result struct {
	Crit   bool
	Scalar float64
}

type Bounds struct {
	Min    float64
	HasMin bool
	Max    float64
	HasMax bool
}

func ProbabilityBounds() Bounds {
	return Bounds{Min: 0, HasMin: true, Max: 1, HasMax: true}
}

func Resolve(spec Spec) Result {
	if spec.Multiplier == 0 {
		spec.Multiplier = 1
	}
	switch spec.Policy {
	case PolicyDeterministic:
		return Result{Crit: spec.Chance >= 1, Scalar: choose(spec.Chance >= 1, spec.Multiplier, 1)}
	case PolicyExpected:
		return Result{Crit: false, Scalar: 1 + spec.Chance*(spec.Multiplier-1)}
	default:
		return Result{Crit: false, Scalar: 1}
	}
}

func ExpectedParts(rawDamage float64, chanceEffective float64, multiplier float64) (normalPart float64, critPart float64) {
	if multiplier == 0 {
		multiplier = 1
	}
	normalPart = rawDamage * (1 - chanceEffective)
	critPart = rawDamage * chanceEffective * multiplier
	return normalPart, critPart
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

func choose(ok bool, yes float64, no float64) float64 {
	if ok {
		return yes
	}
	return no
}
