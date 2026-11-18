package admission

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// ListenerSources 只借用实际来源和原挂载解析得到的编译字段，不提供状态写入口。
type ListenerSources struct {
	Selection   SourceSelection
	StateFields map[string]planbundle.CompiledProviderStateField
}

// ValidateEquipmentHitListener 按原头部及操作顺序校验完整监听；借用只在本次调用内有效。
// 首个错误保留原身份、路径和引用，不安装效果或冻结运行金额。
func ValidateEquipmentHitListener(input Input, listener planbundle.CompiledListener, sources ListenerSources) *model.EngineError {
	if err := ValidateEquipmentHitListenerHeader(input, listener); err != nil {
		return err
	}
	types := input.Compiled.RuntimeTypes
	for _, operation := range input.Compiled.Operations[int(listener.OperationStart) : int(listener.OperationStart)+int(listener.OperationCount)] {
		if operation.Operation == model.OperationKindStartPassiveProcess {
			if err := validatePassiveProcessListener(input, listener, operation, sources); err != nil {
				return err
			}
			continue
		}
		if operation.Operation == model.OperationKindConsumeTargetMark && targetMarkListenerOwned(input, listener, operation) {
			continue
		}
		if operation.Operation == "heal" || operation.Operation == "resource_change" {
			qualified, eventAmount := OwnedSelfRecovery(input, listener, operation)
			if qualified && (!eventAmount || OwnedSettledEventHeal(input, listener, operation)) {
				continue
			}
		}
		if operation.Operation == "damage" && operation.Target == "target" && operation.HasAmount {
			continue
		}
		if operation.Operation == "state_change" && (operation.StateScope == "state_scope/provider" || operation.StateScope == "state_scope/provider_target") && (operation.Target == "self" || operation.Target == "source") && operation.HasAmount {
			if _, declared := sources.StateFields[operation.Ref]; !declared {
				return fail(input, "source state operation requires its complete declared field", operation.Path)
			}
			continue
		}
		if operation.Operation == model.OperationKindStateDurationChange && operation.StateScope == "state_scope/provider" && (operation.Target == "self" || operation.Target == "source") && operation.ValuePolicy == "subtract" && operation.HasAmount {
			provider := input.Compiled.Providers[operation.OwnerProviderIndex]
			field := provider.StateFields[operation.Ref]
			if provider.AmmoBinding != nil && provider.AmmoBinding.StateKey == operation.Ref && field.AmmoRecovery != nil && field.AmmoRecovery.OneByOne && plannedProvider(sources.Selection, listener.OwnerCombatantKey, listener.OwnerProviderRef) {
				continue
			}
		}
		if operation.Operation == model.OperationKindStateDurationChange && operation.StateScope == "state_scope/provider_target" && operation.Target == "self" && (operation.ValuePolicy == "ensure_remaining" || operation.ValuePolicy == "ensure_remaining_preserve_phase") && operation.HasAmount {
			field, declared := sources.StateFields[operation.Ref]
			if declared && field.ValueType == model.ProviderStateValueInteger && field.StateKind == "" && field.DurationMs > 0 {
				continue
			}
		}
		if operation.Operation == "cooldown_change" && ownedAttackCooldownReduction(input, sources.Selection, listener, operation) {
			continue
		}
		if operation.Operation == "cooldown_change" && ownedTotalCooldownRefund(input, sources.Selection, listener, operation) {
			continue
		}
		if operation.Operation == "cooldown_change" && ownedHitCooldownSet(input, sources.Selection, listener, operation) {
			continue
		}
		if operation.Operation == "provider_duration_change" && ownedProviderDurationListener(input, sources.Selection, listener, operation) {
			continue
		}
		if (operation.Operation == model.OperationKindApplyHitLink || operation.Operation == model.OperationKindApplyAttackLink) && operation.Target == "target" && operation.HasAmount {
			link := types.HitLinkApplied
			if operation.Operation == model.OperationKindApplyAttackLink {
				link = types.AttackLinkApplied
			}
			linkType, declared := link.Lookup()
			if declared && listener.EventMatcher.RequiresAllType(linkType) {
				return fail(input, "a link listener cannot recursively apply the same link", operation.Path)
			}
			continue
		}
		if operation.Operation == "apply_provider" && (operation.Target == "target" || operation.Target == "self") {
			if err := ValidateEquipmentDynamicDefinition(input, listener.OwnerCombatantKey, listener.OwnerProviderRef, operation.ProviderDefinitionRef, operation.Target); err != nil {
				return err
			}
			continue
		}
		return fail(input, "source trigger requires complete opponent damage, owned state, links or a supported dynamic result", operation.Path)
	}
	return nil
}

func plannedProvider(selection SourceSelection, owner, provider string) bool {
	for _, binding := range selection.SkillBindings {
		if binding.Source == owner && binding.ProviderRef == provider {
			return true
		}
	}
	return false
}

func ownedAttackCooldownReduction(input Input, selection SourceSelection, listener planbundle.CompiledListener, operation planbundle.CompiledOperation) bool {
	if !AttackCooldownReductionListener(input, selection.BasicAttack, listener, operation) {
		return false
	}
	ref := attackCooldownAbilityRef(operation.AbilityRefStr, listener.OwnerCombatantKey)
	for _, binding := range selection.SkillBindings {
		if AttackCooldownReductionBinding(input, binding, ref, listener, operation) {
			return true
		}
	}
	return false
}

func attackCooldownAbilityRef(reference, owner string) string {
	parsed, valid := planbundle.ParseAbilityRef(reference)
	if !valid {
		return reference
	}
	combatant := parsed.Combatant
	switch combatant {
	case model.SelectorSelf:
		combatant = owner
	case model.SelectorOpponent:
		combatant = opponent(owner)
	case model.SelectorSource, model.SelectorTarget:
	default:
		return reference
	}
	if combatant == "" {
		return reference
	}
	return combatant + ".provider[" + parsed.ProviderRef + "].ability[" + parsed.AbilityKey + "]"
}

func ownedProviderDurationListener(input Input, selection SourceSelection, listener planbundle.CompiledListener, operation planbundle.CompiledOperation) bool {
	ownerType, ownerDeclared := input.Compiled.RuntimeTypes.SourceOwner.Lookup()
	hitType, hitDeclared := input.Compiled.RuntimeTypes.BasicAttackHit.Lookup()
	startType, startDeclared := input.Compiled.RuntimeTypes.AbilityStarted.Lookup()
	attack := selection.BasicAttack
	hit := hitDeclared && listener.EventMatcher.RequiresAllType(hitType) && (attack == nil || attack.Source == listener.OwnerCombatantKey)
	started := startDeclared && listener.EventMatcher.RequiresAllType(startType)
	if !input.Compiled.HasProviderDurationChange || listener.OwnerCombatantKey != model.SelectorSource || !ownerDeclared ||
		!listener.EventMatcher.RequiresAllType(ownerType) || (!hit && !started) || operation.Target != model.SelectorSelf || operation.ValuePolicy != "ensure_remaining" ||
		!plannedProvider(selection, listener.OwnerCombatantKey, listener.OwnerProviderRef) {
		return false
	}
	for _, actor := range input.Compiled.Combatants {
		for _, mount := range actor.ProviderMounts {
			if actor.Key == listener.OwnerCombatantKey && mount.ProviderRef == listener.OwnerProviderRef && int(mount.DefinitionIndex) == operation.OwnerProviderIndex {
				return true
			}
		}
	}
	return false
}
