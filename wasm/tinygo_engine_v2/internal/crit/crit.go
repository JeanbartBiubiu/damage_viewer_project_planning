// 本文件定义暴击策略骨架，负责 execution 级暴击结果和 scalar 复用的基础表达。
package crit

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

func choose(ok bool, yes float64, no float64) float64 {
	if ok {
		return yes
	}
	return no
}
