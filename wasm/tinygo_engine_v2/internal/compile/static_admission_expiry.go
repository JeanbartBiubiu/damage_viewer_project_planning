package compile

import "tinygo_engine_v2/internal/plan"

func staticLinkedShieldInitialization(compiled *plan.CompiledSession, listener plan.CompiledListener) bool {
	initialized, declared := compiled.RuntimeTypes.SourceInitialized.Lookup()
	ownerType, ownerDeclared := compiled.RuntimeTypes.SourceOwner.Lookup()
	if !compiled.Features.Has(plan.FeatureStateOnExpire) || !declared || !ownerDeclared || !listener.EventMatcher.RequiresAllType(initialized) || !listener.EventMatcher.RequiresAllType(ownerType) || listener.HasAbilityRef || listener.HasCondition || listener.HasOncePerUse || listener.PerCastThrottleMs != 0 || listener.MaxTriggersPerEvent != 1 || listener.OperationCount != 1 || int(listener.OperationStart) >= len(compiled.Operations) {
		return false
	}
	operation := compiled.Operations[listener.OperationStart]
	if operation.OwnerProviderIndex < 0 || operation.OwnerProviderIndex >= len(compiled.Providers) || !compiled.Providers[operation.OwnerProviderIndex].HasStateOnExpire {
		return false
	}
	return operation.Operation == "shield" && operation.Target == "self" && operation.HasAmount && operation.HasShieldLifecycleProvider && !operation.HasCondition && !operation.HasShieldDuration
}

func staticStateExpirySource(compiled *plan.CompiledSession, provider plan.CompiledProvider) bool {
	if (provider.Kind != "character" && provider.Kind != "build") || provider.StableID == "" || provider.Lifecycle != nil || provider.AmmoBinding != nil || len(provider.Processes)+len(provider.Modifiers)+len(provider.StatusContributions) != 0 {
		return false
	}
	if int(provider.AbilityStart)+int(provider.AbilityCount) > len(compiled.Abilities) {
		return false
	}
	for _, ability := range compiled.Abilities[int(provider.AbilityStart) : int(provider.AbilityStart)+int(provider.AbilityCount)] {
		if ability.Kind != "passive_listener" || ability.ProcessControl != nil || ability.Cost != nil || ability.Cooldown != nil || ability.HasCastCondition || ability.TickSpec != nil || ability.HasSkillHit || ability.IsBasicAttack {
			return false
		}
		if ability.OperationCount > 0 && !hasExactListenerOperations(provider, ability) {
			return false
		}
	}
	return true
}

func staticCooldownExpirySource(provider plan.CompiledProvider) bool {
	return provider.Kind == "character" && provider.StableID != "" && provider.Lifecycle == nil &&
		provider.AmmoBinding == nil && len(provider.Processes) == 1 && len(provider.Modifiers)+len(provider.StatusContributions) == 0
}

func staticCooldownExpiryClosure(compiled *plan.CompiledSession, provider plan.CompiledProvider) bool {
	initialIndex := -1
	for _, field := range provider.StateFields {
		if field.OnExpireCount == 0 {
			continue
		}
		if !field.OnExpireBeforeCombat || field.OnExpireCount != 1 || int(field.OnExpireStart) >= len(compiled.Operations) || compiled.Operations[field.OnExpireStart].OwnCooldownTarget == nil {
			return false
		}
		if initialIndex >= 0 && initialIndex != int(field.OnExpireAbilityIndex) {
			return false
		}
		initialIndex = int(field.OnExpireAbilityIndex)
	}
	if initialIndex < 0 || int(provider.AbilityStart)+int(provider.AbilityCount) > len(compiled.Abilities) {
		return false
	}
	for index := int(provider.AbilityStart); index < int(provider.AbilityStart)+int(provider.AbilityCount); index++ {
		ability := compiled.Abilities[index]
		if index == initialIndex {
			if ability.Kind != "active" || ability.IsBasicAttack || ability.HasSkillHit || ability.ProcessControl == nil ||
				ability.ProcessControl.Action != "INITIAL" || ability.ProcessControl.UseRefFromEvent || ability.SkillKey != provider.SkillKey {
				return false
			}
			continue
		}
		if ability.Kind != "passive_listener" || ability.ProcessControl != nil || ability.Cost != nil || ability.Cooldown != nil ||
			ability.HasCastCondition || ability.TickSpec != nil || ability.TargetExpirySpec != nil || ability.IsBasicAttack || ability.HasSkillHit {
			return false
		}
		if ability.OperationCount > 0 && !hasExactListenerOperations(provider, ability) {
			return false
		}
	}
	return true
}

func hasExactListenerOperations(provider plan.CompiledProvider, ability plan.CompiledAbility) bool {
	for _, listener := range provider.Listeners {
		if listener.OperationStart == ability.OperationStart && listener.OperationCount == ability.OperationCount {
			return true
		}
	}
	return false
}

func staticExpiryStateWrites(compiled *plan.CompiledSession, provider plan.CompiledProvider, listener plan.CompiledListener) bool {
	for index := int(listener.OperationStart); index < int(listener.OperationStart)+int(listener.OperationCount); index++ {
		operation := compiled.Operations[index]
		field := provider.StateFields[operation.Ref]
		amount, static := compiled.Formulas.Metadata.FoldStatic(operation.AmountProgram)
		if operation.Operation != "state_change" || operation.StateScope != "state_scope/provider" || operation.Target != "self" ||
			field.OnExpireCount == 0 || !static || amount != 1 || (operation.ValuePolicy != "set" && operation.ValuePolicy != "override") {
			return false
		}
	}
	return true
}
