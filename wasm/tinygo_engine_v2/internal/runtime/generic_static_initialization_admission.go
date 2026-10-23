package runtime

import (
	"math"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/status"
	"tinygo_engine_v2/internal/typeset"
)

func (s *genericRunState) validateStaticInitializer(provider planbundle.CompiledProvider, owner, providerRef string) *model.EngineError {
	cappedParent := s.isIncomingCappedFlatParent(provider, owner, providerRef)
	if (provider.Kind != "item" && provider.Kind != "character" && provider.Kind != "build") || provider.StableID == "" || (provider.AbilityCount != 0 || len(provider.Processes) != 0) && !cappedParent || provider.Lifecycle != nil || len(provider.Listeners) == 0 || len(provider.StateFields)+len(provider.StatusContributions)+len(provider.Modifiers) != 0 {
		return s.basicAttackErr("initializer must be a complete static owned source", "initialSnapshot.combatants.providers")
	}
	for _, listener := range s.compiled.Listeners {
		if listener.OwnerCombatantKey == owner && listener.OwnerProviderRef == providerRef {
			if err := s.validateStaticInitializationListener(listener); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *genericRunState) validateStaticInitializationListener(listener planbundle.CompiledListener) *model.EngineError {
	if s.ownLinkedShieldInitialization(listener) {
		return nil
	}
	initializationType, declared := s.compiled.RuntimeTypes.SourceInitialized.Lookup()
	ownerType, ownerDeclared := s.compiled.RuntimeTypes.SourceOwner.Lookup()
	var eventTypes typeset.TypeSet
	eventTypes.Add(initializationType)
	if !declared || !ownerDeclared || listener.OwnerCombatantKey == "" || listener.OwnerProviderRef == "" || listener.HasAbilityRef || listener.HasCondition || listener.HasOncePerUse || listener.PerCastThrottleMs != 0 || listener.OperationCount == 0 || listener.MaxTriggersPerEvent != 1 || !listener.EventMatcher.RequiresAllType(initializationType) || !listener.EventMatcher.RequiresAllType(ownerType) || !s.listenerMatchesEvent(listener, emittedEvent{eventType: model.EventTypeSourceInitialized, sourceKey: listener.OwnerCombatantKey, targetKey: listener.OwnerCombatantKey}, eventTypes) {
		return s.basicAttackErr("this stage accepts only unconditional owner source initialization listeners", "listeners."+listener.ListenerKey)
	}
	if listener.OperationCount == 1 && s.compiled.Operations[listener.OperationStart].Operation == "shield" && s.pureOwnedLinkedShieldInitialization(listener) {
		return nil
	}
	for _, operation := range s.compiled.Operations[int(listener.OperationStart) : int(listener.OperationStart)+int(listener.OperationCount)] {
		if operation.Operation != "apply_provider" || operation.Target != "self" || operation.ProviderRef == "" || operation.HasCondition || operation.HasAmount || operation.ProviderRefFromEvent {
			return s.basicAttackErr("initialization may only mount a complete permanent modifier on its own source", operation.Path)
		}
		index, exists := s.findProviderDefinitionIndex(operation.ProviderDefinitionRef)
		if !exists {
			return s.basicAttackErr("missing initialized effect definition", operation.Path)
		}
		effect := s.compiled.Providers[index]
		if effect.Kind != "status" || effect.AbilityCount != 0 || effect.Lifecycle != nil || len(effect.Listeners)+len(effect.Processes)+len(effect.StateFields)+len(effect.StatusContributions) != 0 || len(effect.Modifiers) != 1 {
			return s.basicAttackErr("initialized effect must contain one permanent static modifier", operation.Path)
		}
		modifier := effect.Modifiers[0]
		if modifier.HasMaximumReductionRatio && s.isIncomingCappedFlatInitializer(listener, operation) {
			continue
		}
		if !modifier.HasValue || modifier.HasCondition || int(modifier.ValueProgram) >= len(s.formulas.Programs) {
			return s.basicAttackErr("initialization modifier requires a finite constant", operation.Path)
		}
		value, static := s.formulas.FoldStatic(modifier.ValueProgram)
		if modifier.OwnedHealthReads && modifier.Kind == "attribute" && modifier.ValuePolicy == "add" && modifier.Stage == "" && pipeline.ModifierTargetCombatantSelector(modifier.Target) == model.SelectorSelf {
			attributeKey := pipeline.AttributeKeyFromModifierTarget(modifier.Target)
			owner, exists := s.combatants[listener.OwnerCombatantKey]
			if !exists || attributeKey == "hp" || attributeKey == "" {
				return s.basicAttackErr("health-derived addition requires an owned non-HP attribute", operation.Path)
			}
			if _, declared := owner.attributes.Lookup(attributeKey); !declared {
				return s.basicAttackErr("health-derived addition output slot is missing", operation.Path)
			}
			if _, declared := owner.attributes.Lookup("hp"); !declared {
				return s.basicAttackErr("health-derived addition owner HP slot is missing", operation.Path)
			}
			continue
		}
		if !static || math.IsNaN(value) || math.IsInf(value, 0) {
			return s.basicAttackErr("initialization modifier requires an application snapshot constant", operation.Path)
		}
		if effect.PermanentResourceMax && modifier.Kind == "resource_max" && modifier.CurrentValuePolicy == "preserve_initial_current" {
			continue
		}
		if modifier.Kind == "attribute" && pipeline.ModifierTargetCombatantSelector(modifier.Target) == model.SelectorOpponent {
			attributeKey := pipeline.AttributeKeyFromModifierTarget(modifier.Target)
			opponent, exists := s.combatants[opponentCombatantKey(listener.OwnerCombatantKey)]
			if !exists || attributeKey == "" || attributeKey == "hp" {
				return s.basicAttackErr("permanent aura requires a declared non-HP opponent attribute", operation.Path)
			}
			if _, declared := opponent.attributes.Lookup(attributeKey); !declared {
				return s.basicAttackErr("permanent aura opponent attribute slot is missing", operation.Path)
			}
			if modifier.ValuePolicy != "multiply" || modifier.Stage != "total" || value < 0 {
				return s.basicAttackErr("permanent aura requires an explicit nonnegative total multiplier", operation.Path)
			}
			continue
		}
		if modifier.Kind == "attribute" && pipeline.ModifierTargetCombatantSelector(modifier.Target) == model.SelectorSelf {
			attributeKey := pipeline.AttributeKeyFromModifierTarget(modifier.Target)
			owner, ownerExists := s.combatants[listener.OwnerCombatantKey]
			if !ownerExists || attributeKey == "hp" || attributeKey == "" {
				return s.basicAttackErr("permanent skill attribute requires a supported owned non-HP slot", operation.Path)
			}
			if _, exists := owner.attributes.Lookup(attributeKey); !exists {
				return s.basicAttackErr("permanent skill attribute slot is missing", operation.Path)
			}
			if !admissibleOwnedAttributePolicy(modifier) {
				return s.basicAttackErr("permanent skill attribute requires an explicit supported calculation", operation.Path)
			}
			if modifier.ValuePolicy == "complement_multiply" && (value < 0 || value > 1) {
				return s.basicAttackErr("permanent complement ratio must be in [0,1]", operation.Path)
			}
			continue
		}
		if modifier.Kind == "pipeline" && modifier.Command == "heal" && modifier.HealDirection == model.HealReceived && modifier.HealCategory == model.HealAny && modifier.HealGroupCalculationMode == model.HealGroupRatioAdd && modifier.ValuePolicy == "add_percent" {
			continue
		}
		if modifier.Kind == "pipeline" && modifier.Command == "shield" && modifier.Channel == "normal_shield" && modifier.Stage == "received" && modifier.ValuePolicy == "add_percent" {
			continue
		}
		return s.basicAttackErr("unsupported permanent source modifier", operation.Path)
	}
	return nil
}

// 纯初始化盾独立核闭包；旧到期补盾仍由ownLinkedShieldInitialization及其完整门负责。
func (s *genericRunState) pureOwnedLinkedShieldInitialization(listener planbundle.CompiledListener) bool {
	op := s.compiled.Operations[listener.OperationStart]
	if op.OwnerProviderIndex < 0 || op.OwnerProviderIndex >= len(s.compiled.Providers) || op.Target != model.SelectorSelf || !op.HasAmount || op.HasCondition || op.HasShieldDuration || !op.HasShieldLifecycleProvider || op.ShieldRef == "" || int(op.ShieldLifecycleProviderIndex) >= len(s.compiled.Providers) {
		return false
	}
	parent := s.compiled.Providers[op.OwnerProviderIndex]
	if (parent.Kind != "character" && parent.Kind != "build") || parent.StableID == "" || parent.SkillKey == "" || parent.Lifecycle != nil || parent.AmmoBinding != nil || parent.ShieldDefinitionRef != "" || len(parent.Processes)+len(parent.StateFields)+len(parent.Modifiers)+len(parent.StatusContributions) != 0 || len(parent.Listeners) != 1 {
		return false
	}
	actualListener := parent.Listeners[0]
	if actualListener.ListenerKey != listener.ListenerKey || actualListener.OperationStart != listener.OperationStart || actualListener.OperationCount != listener.OperationCount || actualListener.SourceAbilityIndex != listener.SourceAbilityIndex {
		return false
	}
	if parent.AbilityCount == 0 {
		if listener.SourceAbilityIndex >= 0 {
			return false
		}
	} else {
		if parent.AbilityCount != 1 || listener.SourceAbilityIndex != int(parent.AbilityStart) || listener.SourceAbilityIndex >= len(s.compiled.Abilities) {
			return false
		}
		ability := s.compiled.Abilities[listener.SourceAbilityIndex]
		if ability.Kind != "passive_listener" || int(ability.ProviderIndex) != op.OwnerProviderIndex || ability.SkillKey != parent.SkillKey || ability.ProcessControl != nil || ability.TickSpec != nil || ability.Cost != nil || ability.Cooldown != nil || ability.HasCastCondition || ability.HasSkillHit || ability.IsBasicAttack || ability.OperationCount != 0 && (ability.OperationStart != listener.OperationStart || ability.OperationCount != listener.OperationCount) {
			return false
		}
	}
	matched, mounts := false, 0
	for _, actor := range s.compiled.Combatants {
		if actor.Key != listener.OwnerCombatantKey {
			continue
		}
		for _, mount := range actor.ProviderMounts {
			if int(mount.DefinitionIndex) == op.OwnerProviderIndex {
				mounts++
				matched = matched || mount.ProviderRef == listener.OwnerProviderRef
			}
		}
	}
	instance, _, exists := status.FindByRef(s.combatants[listener.OwnerCombatantKey].providers, listener.OwnerProviderRef)
	if mounts != 1 || !matched || !exists || int(instance.DefinitionIndex) != op.OwnerProviderIndex || instance.DefinitionRef != parent.ProviderKey || instance.Source != listener.OwnerCombatantKey || instance.Owner != listener.OwnerCombatantKey || instance.Stacks != 1 || instance.ExpireAt != 0 || len(instance.State) != 0 {
		return false
	}
	amount, static := s.formulas.FoldStatic(op.AmountProgram)
	if !static || math.IsNaN(amount) || math.IsInf(amount, 0) || amount < 0 {
		return false
	}
	shield := s.compiled.Providers[op.ShieldLifecycleProviderIndex]
	if shield.Kind != "status" || shield.SkillKey != parent.SkillKey || shield.ShieldDefinitionRef != op.ShieldRef || shield.AbilityCount != 0 || shield.AmmoBinding != nil || shield.NeedsElapsedTime || len(shield.Listeners)+len(shield.Processes)+len(shield.StateFields)+len(shield.StatusContributions) != 0 || !shield.TypeSet.Empty() || shield.Lifecycle != nil && (shield.Lifecycle.MaxStacks != 1 || shield.Lifecycle.RefreshPolicy != model.RefreshPolicyReplace || shield.Lifecycle.HasDuration || shield.Lifecycle.TickIntervalMs != 0 || shield.Lifecycle.InstanceScope != "") {
		return false
	}
	if len(shield.Modifiers) > 0 {
		// 编译层已有完整静态非HP关联修正证明，此处补真实接收者槽位。
		if !shield.AtomicLinkedShield {
			return false
		}
		for _, modifier := range shield.Modifiers {
			key := pipeline.AttributeKeyFromModifierTarget(modifier.Target)
			if _, exists := s.combatants[listener.OwnerCombatantKey].attributes.Lookup(key); !exists {
				return false
			}
		}
	}
	for _, creator := range s.compiled.Operations {
		if creator.ShieldRef != op.ShieldRef && !(creator.HasShieldLifecycleProvider && creator.ShieldLifecycleProviderIndex == op.ShieldLifecycleProviderIndex) {
			continue
		}
		if creator.Operation != "shield" || creator.OwnerProviderIndex != op.OwnerProviderIndex || creator.Target != model.SelectorSelf || !creator.HasShieldLifecycleProvider || creator.ShieldLifecycleProviderIndex != op.ShieldLifecycleProviderIndex {
			return false
		}
	}
	return true
}
