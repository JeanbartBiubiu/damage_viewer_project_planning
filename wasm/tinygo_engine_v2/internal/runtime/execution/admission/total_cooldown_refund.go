package admission

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func ownedTotalCooldownRefund(input Input, selection SourceSelection, listener planbundle.CompiledListener, operation planbundle.CompiledOperation) bool {
	target := operation.TotalCooldownTarget
	if operation.ValuePolicy != "reduce_total_ratio" || target == nil || listener.OperationCount != 1 || listener.HasOncePerUse || listener.PerCastThrottleMs != 0 || operation.Target != model.SelectorSelf || operation.HasCondition || listener.OwnerCombatantKey != target.CombatantKey || listener.SourceAbilityIndex < 0 || listener.SourceAbilityIndex >= len(input.Compiled.Abilities) {
		return false
	}
	damage, hasDamage := input.Compiled.RuntimeTypes.DamageInstance.Lookup()
	owner, hasOwner := input.Compiled.RuntimeTypes.SourceOwner.Lookup()
	if !hasDamage || !hasOwner || !listener.EventMatcher.RequiresAllType(damage) || !listener.EventMatcher.RequiresAllType(owner) {
		return false
	}
	ability := input.Compiled.Abilities[listener.SourceAbilityIndex]
	if int(ability.ProviderIndex) != operation.OwnerProviderIndex || ability.Kind != "passive_listener" {
		return false
	}
	mounts := 0
	for _, actor := range input.Compiled.Combatants {
		for _, mount := range actor.ProviderMounts {
			if actor.Key == listener.OwnerCombatantKey && mount.ProviderRef == listener.OwnerProviderRef && mount.DefinitionIndex == ability.ProviderIndex {
				mounts++
			}
		}
	}
	if mounts != 1 {
		return false
	}
	for _, binding := range selection.SkillBindings {
		if binding.Source == target.CombatantKey && binding.ProviderRef == target.ProviderRef && binding.InitialAbilityIndex == target.AbilityIndex && input.Compiled.Abilities[target.AbilityIndex].ProviderIndex == target.ProviderIndex && binding.ProviderDefinitionRef == input.Compiled.Providers[target.ProviderIndex].ProviderKey {
			return true
		}
	}
	return false
}
