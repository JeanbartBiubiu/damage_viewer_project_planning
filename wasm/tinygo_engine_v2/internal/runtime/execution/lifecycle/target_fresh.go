package lifecycle

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

type InitialEffectOwner struct {
	Owner     string
	Instances effectpkg.ProviderList
	Bags      *effectpkg.BagState
}

func lookupInitialEffect(owners [2]InitialEffectOwner, key string) InitialEffectOwner {
	for _, owner := range owners {
		if owner.Owner == key {
			return owner
		}
	}
	return InitialEffectOwner{}
}

func (e *Executor) ValidateTargetTimingFresh(owners [2]InitialEffectOwner) *model.EngineError {
	if !e.compiled.Features.Has(plan.FeatureTargetTiming) {
		return nil
	}
	for _, actual := range owners {
		owner, actor := actual.Owner, actual
		for instanceIndex, instanceValues := 0, actor.Instances; instanceIndex < instanceValues.Len(); instanceIndex++ {
			instance := instanceValues.At(instanceIndex)
			if int(instance.DefinitionIndex) >= len(e.compiled.Providers) || len(e.compiled.Providers[instance.DefinitionIndex].TargetTimings) == 0 {
				continue
			}
			matches := 0
			for _, declared := range e.compiled.Combatants {
				if declared.Key != owner {
					continue
				}
				for _, mount := range declared.ProviderMounts {
					if mount.ProviderRef == instance.ProviderRef && mount.DefinitionIndex == instance.DefinitionIndex {
						matches++
					}
				}
			}
			if matches != 1 || instance.Owner != owner || instance.Source != owner || instance.ExpireAt != 0 || instance.Stacks != 1 {
				return e.invariant("initialSnapshot.combatants.providers", "target timing requires its exact unique permanent initial owner mount", "")
			}
		}
	}
	for _, actor := range e.compiled.Combatants {
		for _, mount := range actor.ProviderMounts {
			p := e.compiled.Providers[mount.DefinitionIndex]
			if len(p.TargetTimings) == 0 {
				continue
			}
			instance, _, present := lookupInitialEffect(owners, actor.Key).Instances.Find(mount.ProviderRef)
			if !present || instance.DefinitionIndex != mount.DefinitionIndex {
				return e.invariant("initialSnapshot.combatants.providers", "target timing initial mount is missing or has a foreign definition", "")
			}
			bag := lookupInitialEffect(owners, actor.Key).Bags.Lookup(mount.ProviderRef)
			if !bag.Present() {
				continue
			}
			valid := bag.TargetKey() == ""
			bag.State().Range(func(key string, value float64) bool {
				field, ok := p.StateFields[key]
				valid = valid && ok && value == field.DefaultValue
				return true
			})
			bag.TargetValues().Range(func(_ string, value float64) bool {
				valid = valid && value == 0
				return true
			})
			bag.ExpireAt().Range(func(_ string, value int64) bool {
				valid = valid && value == 0
				return true
			})
			bag.TargetExpireAt().Range(func(_ string, value int64) bool {
				valid = valid && value == 0
				return true
			})
			if !valid {
				return e.invariant("initialSnapshot.combatants.providerState", "target timing only accepts fresh default state before timer restoration", "")
			}
		}
	}
	return nil
}
