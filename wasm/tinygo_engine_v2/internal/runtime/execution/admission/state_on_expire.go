package admission

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

// ownLinkedShieldInitialization 只检查编译来源与完整的自身到期补盾初始化监听。
func ownLinkedShieldInitialization(compiled plan.CompiledSession, listener plan.CompiledListener) bool {
	initialized, declared := compiled.RuntimeTypes.SourceInitialized.Lookup()
	ownerType, ownerDeclared := compiled.RuntimeTypes.SourceOwner.Lookup()
	if !compiled.Features.Has(plan.FeatureStateOnExpire) || !declared || !ownerDeclared || !listener.EventMatcher.RequiresAllType(initialized) || !listener.EventMatcher.RequiresAllType(ownerType) || listener.HasAbilityRef || listener.HasCondition || listener.HasOncePerUse || listener.PerCastThrottleMs != 0 || listener.MaxTriggersPerEvent != 1 || listener.OperationCount != 1 {
		return false
	}
	operation := compiled.Operations[listener.OperationStart]
	if operation.OwnerProviderIndex < 0 || !compiled.Providers[operation.OwnerProviderIndex].HasStateOnExpire {
		return false
	}
	return operation.Operation == "shield" && operation.Target == "self" && operation.HasAmount && operation.HasShieldLifecycleProvider && !operation.HasCondition && !operation.HasShieldDuration
}

// validateStateOnExpireDefinition 校验永久到期来源及能力闭包，不执行初始化。
func validateStateOnExpireDefinition(input Input, provider plan.CompiledProvider) *model.EngineError {
	fail := func() *model.EngineError {
		return fail(input, "state expiry source requires complete permanent own shield initialization and damage-driven state writes", "initialSnapshot.combatants.providers")
	}
	if (provider.Kind != "character" && provider.Kind != "build") || provider.StableID == "" || provider.Lifecycle != nil || provider.AmmoBinding != nil || len(provider.Processes)+len(provider.Modifiers)+len(provider.StatusContributions) != 0 {
		return fail()
	}
	for _, ability := range input.Compiled.Abilities[int(provider.AbilityStart) : int(provider.AbilityStart)+int(provider.AbilityCount)] {
		if ability.Kind != "passive_listener" || ability.ProcessControl != nil || ability.Cost != nil || ability.Cooldown != nil || ability.HasCastCondition || ability.TickSpec != nil || ability.HasSkillHit || ability.IsBasicAttack {
			return fail()
		}
		if ability.OperationCount > 0 {
			complete := false
			for _, listener := range provider.Listeners {
				complete = complete || listener.OperationStart == ability.OperationStart && listener.OperationCount == ability.OperationCount
			}
			if !complete {
				return fail()
			}
		}
	}
	return nil
}
