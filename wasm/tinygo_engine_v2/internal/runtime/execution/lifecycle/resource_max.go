package lifecycle

import (
	"math"

	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/model"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

type ResourceMaximum struct {
	Maximum       float64
	Contributions effectpkg.ResourceContributions
	Records       []model.ResourceChangeContributor
}

func (e *Executor) InitialResourceMaximum(owner string, attributes attribute.Table, instances effectpkg.ProviderList) (float64, *model.EngineError) {
	hp, found := attributes.Lookup("hp")
	if !found || !hp.HasCurrent() || !hp.HasMax() || math.IsNaN(hp.Max) || math.IsInf(hp.Max, 0) || hp.Max < 0 ||
		math.IsNaN(hp.Current) || math.IsInf(hp.Current, 0) || hp.Current < 0 || hp.Current > hp.Max {
		return 0, e.invariant("initialSnapshot.combatants."+owner+".attributes.hp", "resource maximum requires explicit finite valid current/max hp", owner)
	}
	for index := 0; index < instances.Len(); index++ {
		instance := instances.At(index)
		if e.compiled.Providers[instance.DefinitionIndex].HasResourceMax {
			return 0, e.invariant("initialSnapshot.combatants."+owner+".providers", "resource_max instances cannot be restored as a fresh scene", instance.ProviderRef)
		}
	}
	return hp.Max, nil
}

func (e *Executor) ResourceContributor(item effectpkg.ResourceContribution, reason string) model.ResourceChangeContributor {
	provider := e.compiled.Providers[item.DefinitionIndex]
	return model.ResourceChangeContributor{Source: item.Source, ProviderRef: item.ProviderRef, DefinitionRef: provider.ProviderKey,
		ModifierKey: provider.Modifiers[item.ModifierIndex].ModifierKey, Reason: reason, UseRef: item.UseRef}
}

func (e *Executor) ProjectResourceMaximum(instances effectpkg.InstanceChangeSet, anchor float64, records []model.ResourceChangeContributor, now int64) ResourceMaximum {
	result := ResourceMaximum{Maximum: anchor, Records: records}
	for index, values := 0, instances.Providers(); index < values.Len(); index++ {
		instance := values.At(index)
		if instance.Expired(now) {
			continue
		}
		provider := e.compiled.Providers[instance.DefinitionIndex]
		if !provider.HasResourceMax {
			continue
		}
		for modifierIndex, modifier := range provider.Modifiers {
			if modifier.Kind == "resource_max" {
				result.Maximum += modifier.StaticValue
				result.Contributions = result.Contributions.Append(effectpkg.ResourceContribution{
					ProviderRef: instance.ProviderRef, Source: instance.Source, UseRef: instance.ActivationUseRef,
					DefinitionIndex: instance.DefinitionIndex, ModifierIndex: uint16(modifierIndex), Value: modifier.StaticValue})
			}
		}
	}
	// 惰性到期只结算贡献，原清理仍拥有实际卸载、证据和队列预算。
	for index, values := 0, instances.ResourceContributions(); index < values.Len(); index++ {
		old := values.At(index)
		if result.Contributions.Contains(old.ProviderRef, old.ModifierIndex) {
			continue
		}
		found := false
		for _, item := range result.Records {
			if item.ProviderRef == old.ProviderRef && item.ModifierKey == e.compiled.Providers[old.DefinitionIndex].Modifiers[old.ModifierIndex].ModifierKey {
				found = true
				break
			}
		}
		if !found {
			result.Records = append(result.Records, e.ResourceContributor(old, "expire"))
		}
	}
	return result
}

// ResourceExpiryNeeded 只判断实际资源上限贡献是否已无活动实例，物理卸载仍由原清理事件处理。
func ResourceExpiryNeeded(instances effectpkg.InstanceState, now int64) bool {
	for index, values := 0, instances.ResourceContributions(); index < values.Len(); index++ {
		item := values.At(index)
		instance, _, found := instances.Providers().Find(item.ProviderRef)
		if !found || instance.Expired(now) {
			return true
		}
	}
	return false
}
