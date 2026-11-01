package lifecycle

import (
	"tinygo_engine_v2/internal/plan"
)

func FindTickAbility(provider plan.CompiledProvider, session plan.CompiledSession) (*plan.CompiledAbility, bool) {
	start := provider.AbilityStart
	end := start + provider.AbilityCount
	for i := start; i < end; i++ {
		ability := session.Abilities[i]
		if ability.Kind == "tick" {
			return &session.Abilities[i], true
		}
	}
	return nil, false
}

func (e *Executor) TickSchedule(defIdx uint16) (intervalMs, startDelayMs int64, ok bool) {
	provider := e.compiled.Providers[defIdx]
	tickAbility, hasTick := FindTickAbility(provider, *e.compiled)

	if provider.Lifecycle != nil && provider.Lifecycle.TickIntervalMs > 0 {
		intervalMs = provider.Lifecycle.TickIntervalMs
	}
	if hasTick && tickAbility.TickSpec != nil {
		if tickAbility.TickSpec.IntervalMs > 0 {
			intervalMs = tickAbility.TickSpec.IntervalMs
		}
		startDelayMs = tickAbility.TickSpec.StartDelayMs
	}
	if intervalMs <= 0 && !hasTick {
		return 0, 0, false
	}
	if intervalMs <= 0 {
		return 0, 0, false
	}
	if startDelayMs <= 0 {
		if !hasTick || tickAbility.TickSpec == nil || !tickAbility.TickSpec.ImmediateFirst {
			startDelayMs = intervalMs
		}
	}
	return intervalMs, startDelayMs, true
}
