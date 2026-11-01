package execution

import (
	"tinygo_engine_v2/internal/base/typeset"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/execution/admission"
)

func (s *Engine) validateBasicAttackInitialSnapshot() *model.EngineError {
	return s.validateInitialSelection(true)
}

func (s *Engine) validateInitialSelection(checkMaximum bool) *model.EngineError {
	return admission.ValidateInitialSelection(s.admissionInput(model.SelectorSource), s.req.InitialSnapshot.Combatants, checkMaximum)
}

func (s *Engine) validateIdleBasicAttackProvider(provider planbundle.CompiledProvider, owner, ref string) *model.EngineError {
	start, initialRef, err := admission.ValidateIdleBasicAttackAbilities(s.admissionInput(owner), provider, owner, ref, validBasicAttackAmmoProvider(provider))
	if err != nil {
		return err
	}
	fail := func() *model.EngineError {
		return s.basicAttackErr("idle opponent binding must contain its complete static basic attack and unique owner-start listener", "initialSnapshot.combatants.providers")
	}
	startType, declared := s.compiled.RuntimeTypes.BasicAttackStart.Lookup()
	ownerType, ownerDeclared := s.compiled.RuntimeTypes.SourceOwner.Lookup()
	start.TypeSet.Add(startType)
	listeners := 0
	for _, listener := range s.compiled.Listeners {
		if listener.OwnerCombatantKey != owner || listener.OwnerProviderRef != ref {
			continue
		}
		if !declared || !ownerDeclared || !listener.HasAbilityRef || normalizeAbilityRef(listener.AbilityRef, owner, opponentCombatantKey(owner)) != initialRef || listener.OperationCount != 0 || listener.HasCondition || listener.HasOncePerUse || listener.PerCastThrottleMs != 0 || listener.MaxTriggersPerEvent != 1 || !listener.EventMatcher.RequiresAllType(startType) || !listener.EventMatcher.RequiresAllType(ownerType) || !s.listenerMatchesEvent(listener, emittedEvent{eventType: model.EventTypeBasicAttackStart, sourceKey: owner, targetKey: opponentCombatantKey(owner)}, start.TypeSet) {
			return fail()
		}
		listeners++
	}
	if listeners != 1 {
		return fail()
	}
	return nil
}

// 只借用当前准入涉及的双方数值，不将执行器或状态集合传入子包。
func (s *Engine) admissionInput(owner string) admission.Input {
	out := admission.Input{Compiled: &s.compiled, Formulas: &s.formulas, Identity: admission.Identity{SchemaHash: s.compiled.SchemaHash, RulesHash: s.compiled.RulesHash, SessionID: s.req.SessionID}}
	for i, key := range [2]string{owner, opponentCombatantKey(owner)} {
		value, present := s.combatants[key]
		out.Actors[i] = admission.Actor{Key: key, Attributes: value.attributesView(), Resources: value.resourceView(), Present: present}
	}
	return out
}

func (s *Engine) validateEquipmentPeriodicProvider(provider planbundle.CompiledProvider, owner, providerRef string) *model.EngineError {
	if err := admission.ValidateEquipmentPeriodicDefinition(s.admissionInput(owner), provider, owner); err != nil {
		return err
	}
	for _, listener := range s.compiled.Listeners {
		if listener.OwnerCombatantKey == owner && listener.OwnerProviderRef == providerRef {
			if err := s.validateEquipmentHitListener(listener); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Engine) validateStaticInitializer(provider planbundle.CompiledProvider, owner, providerRef string) *model.EngineError {
	if err := admission.ValidateStaticInitializerDefinition(s.admissionInput(owner), provider, s.isIncomingCappedFlatParent(provider, owner, providerRef)); err != nil {
		return err
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

func (s *Engine) validateStaticInitializationListener(listener planbundle.CompiledListener) *model.EngineError {
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
		if err := admission.ValidateStaticInitializationOperation(s.admissionInput(listener.OwnerCombatantKey), listener, operation, s.isIncomingCappedFlatInitializer(listener, operation)); err != nil {
			return err
		}

	}
	return nil
}

// 纯初始化盾独立核闭包；旧到期补盾仍由ownLinkedShieldInitialization及其完整门负责。
func (s *Engine) pureOwnedLinkedShieldInitialization(listener planbundle.CompiledListener) bool {
	instance, _, present := s.combatants[listener.OwnerCombatantKey].instances.Providers().Find(listener.OwnerProviderRef)
	return admission.PureOwnedLinkedShieldInitialization(s.admissionInput(listener.OwnerCombatantKey), listener, admission.InitialProvider{Present: present, DefinitionIndex: instance.DefinitionIndex, DefinitionRef: instance.DefinitionRef, Source: instance.Source, Owner: instance.Owner, Stacks: instance.Stacks, ExpireAt: instance.ExpireAt, StateCount: instance.State.Len()})
}

func (s *Engine) validateTargetTimingProvider(provider planbundle.CompiledProvider, owner, ref string) *model.EngineError {
	if err := admission.ValidateTargetTimingDefinition(s.admissionInput(owner), provider, ref); err != nil {
		return err
	}
	for _, listener := range s.compiled.Listeners {
		if listener.OwnerCombatantKey == owner && listener.OwnerProviderRef == ref {
			if err := s.validateEquipmentHitListener(listener); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Engine) addTargetTimingOperations(provider planbundle.CompiledProvider, allowed map[string]bool) {
	admission.AddTargetTimingOperations(s.compiled, provider, allowed)
}

// 永久技能伴随来源使用真实目标状态驱动周期；装备固定周期仍走自己的准入。
func (s *Engine) validateTargetWindowProvider(provider planbundle.CompiledProvider, owner, providerRef string) *model.EngineError {
	if len(provider.TargetTimings) > 0 {
		return s.validateTargetTimingProvider(provider, owner, providerRef)
	}
	if err := admission.ValidateTargetWindowDefinition(s.admissionInput(owner), provider, owner); err != nil {
		return err
	}
	for _, listener := range s.compiled.Listeners {
		if listener.OwnerCombatantKey == owner && listener.OwnerProviderRef == providerRef {
			if err := s.validateEquipmentHitListener(listener); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Engine) validateEquipmentHitListener(listener planbundle.CompiledListener) *model.EngineError {
	if err := admission.ValidateEquipmentHitListenerHeader(s.admissionInput(listener.OwnerCombatantKey), listener); err != nil {
		return err
	}
	types := s.compiled.RuntimeTypes
	for _, operation := range s.compiled.Operations[int(listener.OperationStart) : int(listener.OperationStart)+int(listener.OperationCount)] {
		if operation.Operation == model.OperationKindConsumeTargetMark && s.targetMarkListenerOwned(listener, operation) {
			continue
		}
		if (operation.Operation == "heal" || operation.Operation == "resource_change") && s.isOwnedSettledSelfRecovery(listener, operation) {
			continue
		}
		if operation.Operation == "damage" && operation.Target == "target" && operation.HasAmount {
			continue
		}
		if operation.Operation == "state_change" && (operation.StateScope == stateScopeProvider || operation.StateScope == stateScopeProviderTarget) && (operation.Target == "self" || operation.Target == "source") && operation.HasAmount {
			fields := s.resolveProviderStateFieldDefs(listener.OwnerCombatantKey, listener.OwnerProviderRef, s.combatants[listener.OwnerCombatantKey].instances.Providers()).Definitions()
			if _, declared := fields.Lookup(operation.Ref); !declared {
				return s.basicAttackErr("source state operation requires its complete declared field", operation.Path)
			}
			continue
		}
		if operation.Operation == model.OperationKindStateDurationChange && operation.StateScope == stateScopeProvider && (operation.Target == "self" || operation.Target == "source") && operation.ValuePolicy == "subtract" && operation.HasAmount {
			provider := s.compiled.Providers[operation.OwnerProviderIndex]
			field := provider.StateFields[operation.Ref]
			if provider.AmmoBinding != nil && provider.AmmoBinding.StateKey == operation.Ref && field.AmmoRecovery != nil && field.AmmoRecovery.OneByOne && s.plannedSkillProvider(listener.OwnerCombatantKey, listener.OwnerProviderRef) {
				continue
			}
		}
		if operation.Operation == model.OperationKindStateDurationChange && operation.StateScope == stateScopeProviderTarget && operation.Target == "self" && (operation.ValuePolicy == "ensure_remaining" || operation.ValuePolicy == "ensure_remaining_preserve_phase") && operation.HasAmount {
			fields := s.resolveProviderStateFieldDefs(listener.OwnerCombatantKey, listener.OwnerProviderRef, s.combatants[listener.OwnerCombatantKey].instances.Providers()).Definitions()
			field, declared := fields.Lookup(operation.Ref)
			if declared && field.ValueType == model.ProviderStateValueInteger && field.StateKind == "" && field.DurationMs > 0 {
				continue
			}
		}
		if operation.Operation == "cooldown_change" && s.isOwnedAttackCooldownReduction(listener, operation) {
			continue
		}
		if operation.Operation == "cooldown_change" && s.isOwnedTotalCooldownRefund(listener, operation) {
			continue
		}
		if operation.Operation == "provider_duration_change" && s.isOwnedProviderDurationListener(listener, operation) {
			continue
		}
		if (operation.Operation == model.OperationKindApplyHitLink || operation.Operation == model.OperationKindApplyAttackLink) && operation.Target == "target" && operation.HasAmount {
			link := types.HitLinkApplied
			if operation.Operation == model.OperationKindApplyAttackLink {
				link = types.AttackLinkApplied
			}
			linkType, declared := link.Lookup()
			if declared && listener.EventMatcher.RequiresAllType(linkType) {
				return s.basicAttackErr("a link listener cannot recursively apply the same link", operation.Path)
			}
			continue
		}
		if operation.Operation == "apply_provider" && (operation.Target == "target" || operation.Target == "self") {
			if err := s.validateEquipmentDynamicDefinition(listener.OwnerCombatantKey, listener.OwnerProviderRef, operation.ProviderDefinitionRef, operation.Target); err != nil {
				return err
			}
			continue
		}
		return s.basicAttackErr("source trigger requires complete opponent damage, owned state, links or a supported dynamic result", operation.Path)
	}
	return nil
}

func (s *Engine) isOwnedSettledSelfRecovery(listener planbundle.CompiledListener, operation planbundle.CompiledOperation) bool {
	qualified, eventAmount := admission.OwnedSettledSelfRecovery(s.admissionInput(listener.OwnerCombatantKey), listener, operation)
	return qualified && (!eventAmount || s.isOwnedSettledEventHeal(listener, operation))
}

func (s *Engine) isOwnedAttackCooldownReduction(listener planbundle.CompiledListener, operation planbundle.CompiledOperation) bool {
	input := s.admissionInput(listener.OwnerCombatantKey)
	if !admission.AttackCooldownReductionListener(input, s.req.DriverPlan.BasicAttack, listener, operation) {
		return false
	}
	ref := normalizeAbilityRef(operation.AbilityRefStr, listener.OwnerCombatantKey, opponentCombatantKey(listener.OwnerCombatantKey))
	for _, action := range s.plannedSkillSources() {
		if admission.AttackCooldownReductionBinding(input, action.Binding(), ref, listener, operation) {
			return true
		}
	}
	return false
}

func (s *Engine) validateEquipmentDynamicDefinition(owner, providerRef, reference, target string) *model.EngineError {
	return admission.ValidateEquipmentDynamicDefinition(s.admissionInput(owner), owner, providerRef, reference, target)
}

func (s *Engine) validateEquipmentHitProvider(provider planbundle.CompiledProvider, owner, providerRef string) *model.EngineError {
	if provider.HasStateOnExpire {
		return s.validateStateOnExpireProvider(provider, owner, providerRef)
	}
	if err := admission.ValidateEquipmentHitDefinition(s.admissionInput(owner), provider, owner); err != nil {
		return err
	}
	for _, listener := range s.compiled.Listeners {
		if listener.OwnerCombatantKey == owner && listener.OwnerProviderRef == providerRef {
			if err := s.validateStaticInitializationListener(listener); err == nil {
				continue
			}
			if err := s.validateEquipmentHitListener(listener); err != nil {
				return err
			}
		}
	}
	return nil
}
