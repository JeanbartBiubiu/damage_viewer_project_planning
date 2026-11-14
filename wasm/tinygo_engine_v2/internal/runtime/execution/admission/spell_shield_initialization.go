package admission

import (
	"tinygo_engine_v2/internal/base/typeset"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// 仅识别作者已经完整声明的单层自身法盾初始化与冻结实例消费闭包，不放宽普通初始化操作。
func ownedSpellShieldInitializer(input Input, parent planbundle.CompiledProvider, owner, reference string, reads InitialSourceReads) bool {
	return ownedSpellShieldInitialization(input, parent, owner, reference, reads, nil)
}

func ownedSpellShieldInitializationListener(input Input, listener planbundle.CompiledListener, reads InitialSourceReads) bool {
	if listener.SourceAbilityIndex < 0 || listener.SourceAbilityIndex >= len(input.Compiled.Abilities) {
		return false
	}
	index := input.Compiled.Abilities[listener.SourceAbilityIndex].ProviderIndex
	if int(index) >= len(input.Compiled.Providers) {
		return false
	}
	return ownedSpellShieldInitialization(input, input.Compiled.Providers[index], listener.OwnerCombatantKey, listener.OwnerProviderRef, reads, &listener)
}

// 来源准入和普攻逐监听准入共享完整闭包；显式监听仍按调用处传入的实际内容校验。
func ownedSpellShieldInitialization(input Input, parent planbundle.CompiledProvider, owner, reference string, reads InitialSourceReads, selected *planbundle.CompiledListener) bool {
	if (parent.Kind != "item" && parent.Kind != "character" && parent.Kind != "build") || parent.StableID == "" || parent.SkillKey == "" || parent.AbilityCount != 1 || parent.Lifecycle != nil || len(parent.Processes)+len(parent.StateFields)+len(parent.Modifiers)+len(parent.StatusContributions) != 0 || len(parent.Listeners) != 1 {
		return false
	}
	if int(parent.AbilityStart) >= len(input.Compiled.Abilities) {
		return false
	}
	ability := input.Compiled.Abilities[parent.AbilityStart]
	if ability.Kind != "passive_listener" || ability.SkillKey != parent.SkillKey || ability.ProcessControl != nil || ability.TickSpec != nil || ability.Cost != nil || ability.Cooldown != nil || ability.HasCastCondition || ability.HasSkillHit || ability.IsBasicAttack {
		return false
	}
	listener := parent.Listeners[0]
	boundCount := 0
	for _, candidate := range input.Compiled.Listeners {
		if candidate.OwnerCombatantKey == owner && candidate.OwnerProviderRef == reference {
			if candidate.ListenerKey != listener.ListenerKey || candidate.OperationStart != listener.OperationStart || candidate.SourceAbilityIndex != listener.SourceAbilityIndex {
				return false
			}
			listener = candidate
			boundCount++
		}
	}
	if boundCount != 1 {
		return false
	}
	if selected != nil {
		if selected.ListenerKey != listener.ListenerKey || selected.OperationStart != listener.OperationStart || selected.SourceAbilityIndex != listener.SourceAbilityIndex {
			return false
		}
		listener = *selected
	}
	initialized, hasInitialized := input.Compiled.RuntimeTypes.SourceInitialized.Lookup()
	ownerType, hasOwner := input.Compiled.RuntimeTypes.SourceOwner.Lookup()
	if !hasInitialized || !hasOwner || listener.OwnerCombatantKey != owner || listener.OwnerProviderRef != reference || listener.SourceAbilityIndex != int(parent.AbilityStart) || listener.HasAbilityRef || listener.HasCondition || listener.HasOncePerUse || listener.PerCastThrottleMs != 0 || listener.MaxTriggersPerEvent != 1 || listener.OperationCount != 1 || !listener.EventMatcher.RequiresAllType(initialized) || !listener.EventMatcher.RequiresAllType(ownerType) || int(listener.OperationStart) >= len(input.Compiled.Operations) {
		return false
	}
	if ability.OperationCount != 0 && (ability.OperationStart != listener.OperationStart || ability.OperationCount != listener.OperationCount) {
		return false
	}
	var eventTypes typeset.TypeSet
	eventTypes.Add(initialized)
	if !reads.InitialListenerMatches(listener, model.EventTypeSourceInitialized, owner, owner, eventTypes) {
		return false
	}
	instance := reads.InitialProviderView(owner, reference)
	if !instance.Present || instance.DefinitionRef != parent.ProviderKey || instance.Owner != owner || instance.Source != owner || instance.Stacks != 1 || instance.ExpireAt != 0 || instance.StateCount != 0 || int(instance.DefinitionIndex) != int(ability.ProviderIndex) {
		return false
	}
	mounts := 0
	for _, actor := range input.Compiled.Combatants {
		for _, mount := range actor.ProviderMounts {
			if mount.DefinitionIndex == ability.ProviderIndex {
				mounts++
				if actor.Key != owner || mount.ProviderRef != reference {
					return false
				}
			}
		}
	}
	if mounts != 1 {
		return false
	}
	op := input.Compiled.Operations[listener.OperationStart]
	if op.Operation != "apply_provider" || op.Target != "self" || op.OwnerProviderIndex != int(ability.ProviderIndex) || op.ProviderRef == "" || op.HasCondition || op.HasAmount || op.ProviderRefFromEvent {
		return false
	}
	index, found := definitionIndex(input, op.ProviderDefinitionRef)
	if !found {
		return false
	}
	shield := input.Compiled.Providers[index]
	spell, hasSpell := input.Compiled.RuntimeTypes.SpellShield.Lookup()
	var onlySpell typeset.TypeSet
	onlySpell.Add(spell)
	if !hasSpell || shield.TypeSet != onlySpell || shield.SkillKey != parent.SkillKey || shield.Kind != "status" || shield.StableID == "" || shield.AbilityCount != 0 || shield.Lifecycle == nil || shield.Lifecycle.MaxStacks != 1 || shield.Lifecycle.RefreshPolicy != "replace" || shield.Lifecycle.HasDuration || shield.Lifecycle.TickIntervalMs != 0 || len(shield.Processes)+len(shield.StateFields)+len(shield.Modifiers)+len(shield.StatusContributions) != 0 || len(shield.Listeners) != 1 {
		return false
	}
	consume := shield.Listeners[0]
	blocked, hasBlocked := input.Compiled.Types.Registry.Lookup(model.EventTypeSpellShieldBlocked)
	blockedMatcher, matcherProblems := typeset.CompileDomainMatcher(model.TypeMatcherV2{All: []string{model.EventTypeSpellShieldBlocked}}, input.Compiled.Types.Registry, "event")
	if !hasBlocked || len(matcherProblems) != 0 || consume.HasAbilityRef || consume.HasCondition || consume.HasOncePerUse || consume.PerCastThrottleMs != 0 || consume.MaxTriggersPerEvent != 1 || consume.OperationCount != 1 || !consume.EventMatcher.RequiresAllType(blocked) || consume.EventMatcher != blockedMatcher || int(consume.OperationStart) >= len(input.Compiled.Operations) {
		return false
	}
	remove := input.Compiled.Operations[consume.OperationStart]
	return remove.OwnerProviderIndex == int(index) && remove.Operation == "expire_provider" && remove.Target == "self" && remove.ProviderRefFromEvent && remove.ProviderRef == "" && !remove.HasAmount && !remove.HasCondition
}
