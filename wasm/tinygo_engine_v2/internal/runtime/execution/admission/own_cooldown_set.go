package admission

import (
	"tinygo_engine_v2/internal/model"
	plan "tinygo_engine_v2/internal/plan"
)

func ownedHitCooldownSet(input Input, selection SourceSelection, listener plan.CompiledListener, operation plan.CompiledOperation) bool {
	owner, hasOwner := input.Compiled.RuntimeTypes.SourceOwner.Lookup()
	attack, hasAttack := input.Compiled.RuntimeTypes.BasicAttackHit.Lookup()
	skill, hasSkill := input.Compiled.RuntimeTypes.SkillHit.Lookup()
	if !hasOwner || !listener.EventMatcher.RequiresAllType(owner) || listener.OwnerCombatantKey != model.SelectorSource ||
		operation.Operation != "cooldown_change" || operation.ValuePolicy != "set_remaining" || operation.Target != model.SelectorSelf ||
		!operation.HasAmount || !operation.HasAbilityRef || operation.HasCondition || operation.OwnCooldownTarget == nil ||
		!selectedOwnInitialCooldown(input, selection, listener.OwnerCombatantKey, listener.OwnerProviderRef, operation) {
		return false
	}
	if hasAttack && listener.EventMatcher.RequiresAllType(attack) && selection.BasicAttack != nil && selection.BasicAttack.Source == listener.OwnerCombatantKey {
		return true
	}
	if hasSkill && listener.EventMatcher.RequiresAllType(skill) {
		for _, binding := range selection.SkillBindings {
			typeID, declared := input.Compiled.Types.Registry.Lookup("ability/skill/" + binding.SkillKey)
			if binding.Source == listener.OwnerCombatantKey && declared && listener.EventMatcher.RequiresAllType(typeID) {
				return true
			}
		}
	}
	return false
}

func selectedOwnInitialCooldown(input Input, selection SourceSelection, owner, provider string, operation plan.CompiledOperation) bool {
	target := operation.OwnCooldownTarget
	if target == nil || target.CombatantKey != owner || target.ProviderRef != provider || int(target.ProviderIndex) != operation.OwnerProviderIndex {
		return false
	}
	for _, binding := range selection.SkillBindings {
		if binding.Source == owner && binding.ProviderRef == provider && binding.InitialAbilityIndex == target.AbilityIndex &&
			binding.ProviderDefinitionRef == input.Compiled.Providers[target.ProviderIndex].ProviderKey &&
			binding.SkillKey == input.Compiled.Abilities[target.AbilityIndex].SkillKey {
			return true
		}
	}
	return false
}

// ValidateCooldownStateExpirySources 在实际手动／自动计划建立后核对新增冷却到期来源，不移动旧回盾检查。
func ValidateCooldownStateExpirySources(input Input, reads InitialSourceReads) *model.EngineError {
	if !input.Compiled.Features.Has(plan.FeatureStateOnExpire) {
		return nil
	}
	for _, actor := range input.Compiled.Combatants {
		for _, mount := range actor.ProviderMounts {
			provider := input.Compiled.Providers[mount.DefinitionIndex]
			if provider.HasCooldownStateExpiry {
				if err := validateCooldownStateExpiryProvider(initialActorInput(input, actor.Key, reads), provider, actor.Key, mount.ProviderRef, reads); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func validateCooldownStateExpiryProvider(input Input, provider plan.CompiledProvider, owner, reference string, reads InitialSourceReads) *model.EngineError {
	failure := func() *model.EngineError {
		return fail(input, "cooldown expiry source requires its actual owned INITIAL and complete finite state closure", "initialSnapshot.combatants.providers")
	}
	if owner != model.SelectorSource || provider.Kind != "character" || provider.StableID == "" || provider.Lifecycle != nil ||
		provider.AmmoBinding != nil || len(provider.Processes) != 1 || len(provider.Modifiers)+len(provider.StatusContributions) != 0 {
		return failure()
	}
	sources := reads.InitialListenerSources(plan.CompiledListener{OwnerCombatantKey: owner, OwnerProviderRef: reference})
	initialIndex := -1
	for _, field := range provider.StateFields {
		if field.OnExpireCount == 0 {
			continue
		}
		operation := input.Compiled.Operations[field.OnExpireStart]
		if !field.OnExpireBeforeCombat || field.OnExpireCount != 1 || !selectedOwnInitialCooldown(input, sources.Selection, owner, reference, operation) {
			return failure()
		}
		if initialIndex >= 0 && initialIndex != int(field.OnExpireAbilityIndex) {
			return failure()
		}
		initialIndex = int(field.OnExpireAbilityIndex)
	}
	if initialIndex < 0 {
		return failure()
	}
	for index := int(provider.AbilityStart); index < int(provider.AbilityStart)+int(provider.AbilityCount); index++ {
		ability := input.Compiled.Abilities[index]
		if index == initialIndex {
			if ability.Kind != "active" || ability.IsBasicAttack || ability.HasSkillHit || ability.ProcessControl == nil ||
				ability.ProcessControl.Action != "INITIAL" || ability.ProcessControl.UseRefFromEvent || ability.SkillKey != provider.SkillKey {
				return failure()
			}
			continue
		}
		if ability.Kind != "passive_listener" || ability.ProcessControl != nil || ability.Cost != nil || ability.Cooldown != nil ||
			ability.HasCastCondition || ability.TickSpec != nil || ability.TargetExpirySpec != nil || ability.IsBasicAttack || ability.HasSkillHit {
			return failure()
		}
		if ability.OperationCount > 0 {
			complete := false
			for _, listener := range provider.Listeners {
				complete = complete || listener.OperationStart == ability.OperationStart && listener.OperationCount == ability.OperationCount
			}
			if !complete {
				return failure()
			}
		}
	}
	for _, listener := range input.Compiled.Listeners {
		if listener.OwnerCombatantKey != owner || listener.OwnerProviderRef != reference {
			continue
		}
		if err := validateInitialEquipmentHitListener(input, listener, reads); err != nil {
			return err
		}
	}
	return nil
}
