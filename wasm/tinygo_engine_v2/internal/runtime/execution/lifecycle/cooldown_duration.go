package lifecycle

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

func (e *Executor) CooldownDurationFactor(p *actionpkg.ProcessView, instances effectpkg.ProviderList, now int64) (float64, *model.EngineError) {
	if !e.compiled.Features.Has(plan.FeatureCooldownDuration) {
		return 1, nil
	}
	product := 1.0
	for instanceIndex, instanceValues := 0, instances; instanceIndex < instanceValues.Len(); instanceIndex++ {
		inst := instanceValues.At(instanceIndex)
		if inst.Expired(now) {
			continue
		}
		provider := e.compiled.Providers[inst.DefinitionIndex]
		if !provider.HasCooldownDuration {
			continue
		}
		for _, mod := range provider.Modifiers {
			if mod.Kind != "cooldown_duration" {
				continue
			}
			for _, ref := range mod.CooldownTargets {
				if ref.CombatantKey == p.Owner() && ref.ProviderRef == p.ProviderRef() && ref.ProviderIndex == p.Ability().ProviderIndex && int(ref.AbilityIndex) == p.Definition().InitialAbilityIndex {
					product *= mod.StaticValue
					break
				}
			}
		}
	}
	return product, nil
}
