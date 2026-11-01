package actionflow

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// PlannedSourceChecks 只借用现有来源监听准入和明确属性接收槽，不提供执行能力。
type PlannedSourceChecks interface {
	// StaticSourceListener 按现有初始化准入核对一个实际挂载监听。
	StaticSourceListener(listener planbundle.CompiledListener) *model.EngineError
	// HitSourceListener 按现有命中准入核对同一个实际挂载监听。
	HitSourceListener(listener planbundle.CompiledListener) *model.EngineError
	// PlannedAttributeSlot 返回实际接收者存在性与明确属性槽存在性，不补默认槽。
	PlannedAttributeSlot(selector, source, target, key string) (bool, bool)
}

func (state SkillActionExecutor) PlannedProvider(owner, provider string) bool {
	for _, action := range state.PlannedSources() {
		if action.Binding().Source == owner && action.Binding().ProviderRef == provider {
			return true
		}
	}
	return false
}

func (state SkillActionExecutor) PlannedOperation(providerIndex int) bool {
	if providerIndex < 0 || providerIndex >= len(state.providers) {
		return false
	}
	definition := state.providers[providerIndex].ProviderKey
	for _, action := range state.PlannedSources() {
		if action.Binding().ProviderDefinitionRef == definition {
			return true
		}
	}
	return false
}

func (state SkillActionExecutor) ValidateSource(owner, providerRef string, providerIndex uint16, listeners []planbundle.CompiledListener, operations []planbundle.CompiledOperation, startedType planbundle.DeclaredType, checks PlannedSourceChecks) *model.EngineError {
	provider := state.providers[providerIndex]
	if provider.Kind != "character" || provider.StableID == "" || len(provider.Processes) != 1 || provider.Lifecycle != nil || provider.AmmoBinding != nil && !ValidBoundAmmoFields(provider) {
		return state.error("planned source requires its complete single-process character binding", "initialSnapshot.combatants.providers")
	}
	for _, ability := range state.abilities[int(provider.AbilityStart) : int(provider.AbilityStart)+int(provider.AbilityCount)] {
		ref := owner + ".provider[" + providerRef + "].ability[" + ability.AbilityKey + "]"
		matched := false
		for _, action := range state.PlannedSources() {
			if action.Binding().ProviderRef == providerRef && action.Binding().Source == owner {
				for _, control := range action.Binding().Controls {
					matched = matched || ref == control.AbilityRef
				}
				for _, hit := range action.Binding().HitBindings {
					matched = matched || ref == hit.HitAbilityRef
				}
				if matched {
					break
				}
			}
		}
		if !matched && (ability.Kind != "passive_listener" || ability.ProcessControl != nil || ability.Cooldown != nil || ability.Cost != nil || ability.TickSpec != nil || ability.HasSkillHit) {
			return state.error("unbound active ability in planned source", ref)
		}
	}
	for _, listener := range listeners {
		if listener.OwnerCombatantKey != owner || listener.OwnerProviderRef != providerRef {
			continue
		}
		started, declared := startedType.Lookup()
		if declared && listener.EventMatcher.RequiresAllType(started) && !listener.HasAbilityRef && listener.OperationCount > 0 && listener.MaxTriggersPerEvent == 1 {
			continue
		}
		if err := checks.StaticSourceListener(listener); err != nil {
			if err := checks.HitSourceListener(listener); err != nil {
				return err
			}
		}
	}
	for index, operation := range operations {
		if operation.OwnerProviderIndex != int(providerIndex) {
			continue
		}
		switch operation.Operation {
		case model.OperationKindConsumeTargetMark:
			if operation.TargetMark == nil || operation.TargetMark.OwnerCombatantKey != owner || operation.TargetMark.OwnerProviderRef != providerRef {
				return state.error("planned mark consumption requires its exact compiled owner", operation.Path)
			}
		case "attribute_change":
			if operation.AttributeKey == "" || operation.AttributeKey == "hp" || operation.ValuePolicy != "add" ||
				(operation.Target != "source" && operation.Target != "self" && operation.Target != "target") ||
				!state.AttributeOperationPosition(provider, index, operations) {
				return state.error("planned attribute change requires an ordinary explicit additive process or instant hit result", operation.Path)
			}
			matched := false
			for _, action := range state.PlannedSources() {
				if action.Binding().Source != owner || action.Binding().ProviderRef != providerRef {
					continue
				}
				matched = true
				exists, slot := checks.PlannedAttributeSlot(operation.Target, action.Plan().Source(), action.Plan().Target(), operation.AttributeKey)
				if !exists {
					return state.error("planned attribute change requires its actual action recipient", operation.Path)
				}
				if !slot {
					return state.error("planned attribute change requires an explicit recipient slot", operation.Path+".attributeKey")
				}
			}
			if !matched {
				return state.error("planned attribute change requires its actual action binding", operation.Path)
			}
		case "damage", "heal", "shield", "state_change", "apply_provider", "expire_provider", "refresh_provider", "provider_duration_change", "cooldown_change", "resource_change", model.OperationKindResolveSkillHit, model.OperationKindApplyAttackLink, model.OperationKindApplyHitLink:
		case model.OperationKindStateDurationChange:
			field := provider.StateFields[operation.Ref]
			if operation.StateScope != "state_scope/provider" || field.StateKind != model.ProviderStateKindAmmo || field.AmmoRecovery == nil || !field.AmmoRecovery.OneByOne {
				return state.error("planned duration change requires its own one-by-one ammo state", operation.Path)
			}
		default:
			return state.error("planned source operation is outside the finite action subset", operation.Path)
		}
	}
	return nil
}

// 两种输入模式在准入时都校验实际选择来源；运行中的自动使用不伪装成手动指令列表。

func (state SkillActionExecutor) AttributeOperationPosition(provider planbundle.CompiledProvider, index int, operations []planbundle.CompiledOperation) bool {
	contains := func(start, count uint16) bool { return index >= int(start) && index < int(start)+int(count) }
	for _, process := range provider.Processes {
		for _, moment := range process.MomentOperations {
			if contains(moment.OperationStart, moment.OperationCount) {
				return true
			}
		}
	}
	for _, ability := range state.abilities[int(provider.AbilityStart) : int(provider.AbilityStart)+int(provider.AbilityCount)] {
		for _, operation := range operations[int(ability.OperationStart) : int(ability.OperationStart)+int(ability.OperationCount)] {
			if operation.SkillHit == nil {
				continue
			}
			for _, candidate := range operation.SkillHit.Candidates {
				if candidate.Semantic.ResultType == model.SkillHitResultAttributeChange && candidate.Semantic.Moment == model.SkillHitMomentInstant && contains(candidate.OperationStart, candidate.OperationCount) {
					return true
				}
			}
		}
	}
	return false
}
