package admission

import (
	"tinygo_engine_v2/internal/model"
	plan "tinygo_engine_v2/internal/plan"
)

func ownedHitCooldownSet(input Input, selection SourceSelection, listener plan.CompiledListener, operation plan.CompiledOperation) bool {
	facts := listener.AdmissionFacts
	if (!facts.OwnAttackCooldownSet && !facts.OwnSkillCooldownSet) ||
		!selectedOwnInitialCooldown(input, selection, listener.OwnerCombatantKey, listener.OwnerProviderRef, operation) {
		return false
	}
	if facts.OwnAttackCooldownSet && selection.BasicAttack != nil && selection.BasicAttack.Source == listener.OwnerCombatantKey {
		return true
	}
	if facts.OwnSkillCooldownSet {
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
	if owner != model.SelectorSource || !provider.AdmissionFacts.CooldownExpirySource {
		return failure()
	}
	sources := reads.InitialListenerSources(plan.CompiledListener{OwnerCombatantKey: owner, OwnerProviderRef: reference})
	if !provider.AdmissionFacts.CooldownExpiryClosure {
		return failure()
	}
	for _, field := range provider.StateFields {
		if field.OnExpireCount != 0 && !selectedOwnInitialCooldown(input, sources.Selection, owner, reference, input.Compiled.Operations[field.OnExpireStart]) {
			return failure()
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
