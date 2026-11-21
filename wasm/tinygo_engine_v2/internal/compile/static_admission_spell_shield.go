package compile

import (
	"tinygo_engine_v2/internal/base/typeset"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// staticSpellShieldClosure 证明绑定初始化监听与法盾消费操作的闭环。
func staticSpellShieldClosure(session *planbundle.CompiledSession, parentIndex int, parent planbundle.CompiledProvider, owner, reference string, listener planbundle.CompiledListener) bool {
	if (parent.Kind != "item" && parent.Kind != "character" && parent.Kind != "build") || parent.StableID == "" || parent.SkillKey == "" || parent.AbilityCount != 1 || parent.Lifecycle != nil || len(parent.Processes)+len(parent.StateFields)+len(parent.Modifiers)+len(parent.StatusContributions) != 0 || len(parent.Listeners) != 1 {
		return false
	}
	if int(parent.AbilityStart) >= len(session.Abilities) {
		return false
	}
	ability := session.Abilities[parent.AbilityStart]
	if int(ability.ProviderIndex) != parentIndex || ability.Kind != "passive_listener" || ability.SkillKey != parent.SkillKey || ability.ProcessControl != nil || ability.TickSpec != nil || ability.Cost != nil || ability.Cooldown != nil || ability.HasCastCondition || ability.HasSkillHit || ability.IsBasicAttack {
		return false
	}

	template := parent.Listeners[0]
	if template.ListenerKey != listener.ListenerKey || template.OperationStart != listener.OperationStart || template.SourceAbilityIndex != listener.SourceAbilityIndex {
		return false
	}
	initialized, hasInitialized := session.RuntimeTypes.SourceInitialized.Lookup()
	ownerType, hasOwner := session.RuntimeTypes.SourceOwner.Lookup()
	if !hasInitialized || !hasOwner || listener.OwnerCombatantKey != owner || listener.OwnerProviderRef != reference || listener.SourceAbilityIndex != int(parent.AbilityStart) || listener.HasAbilityRef || listener.HasCondition || listener.HasOncePerUse || listener.PerCastThrottleMs != 0 || listener.MaxTriggersPerEvent != 1 || listener.OperationCount != 1 || !listener.EventMatcher.RequiresAllType(initialized) || !listener.EventMatcher.RequiresAllType(ownerType) || int(listener.OperationStart) >= len(session.Operations) {
		return false
	}
	if ability.OperationCount != 0 && (ability.OperationStart != listener.OperationStart || ability.OperationCount != listener.OperationCount) {
		return false
	}
	op := session.Operations[listener.OperationStart]
	if op.Operation != "apply_provider" || op.Target != "self" || op.OwnerProviderIndex != int(ability.ProviderIndex) || op.ProviderRef == "" || op.HasCondition || op.HasAmount || op.ProviderRefFromEvent {
		return false
	}
	index, found := findProviderIndex(session, op.ProviderDefinitionRef)
	if !found {
		return false
	}
	shield := session.Providers[index]
	spell, hasSpell := session.RuntimeTypes.SpellShield.Lookup()
	var onlySpell typeset.TypeSet
	onlySpell.Add(spell)
	if !hasSpell || shield.TypeSet != onlySpell || shield.SkillKey != parent.SkillKey || shield.Kind != "status" || shield.StableID == "" || shield.AbilityCount != 0 || shield.Lifecycle == nil || shield.Lifecycle.MaxStacks != 1 || shield.Lifecycle.RefreshPolicy != "replace" || shield.Lifecycle.HasDuration || shield.Lifecycle.TickIntervalMs != 0 || len(shield.Processes)+len(shield.StateFields)+len(shield.Modifiers)+len(shield.StatusContributions) != 0 || len(shield.Listeners) != 1 {
		return false
	}
	consume := shield.Listeners[0]
	blocked, hasBlocked := session.Types.Registry.Lookup(model.EventTypeSpellShieldBlocked)
	blockedMatcher, matcherProblems := typeset.CompileDomainMatcher(model.TypeMatcherV2{All: []string{model.EventTypeSpellShieldBlocked}}, session.Types.Registry, "event")
	if !hasBlocked || len(matcherProblems) != 0 || consume.HasAbilityRef || consume.HasCondition || consume.HasOncePerUse || consume.PerCastThrottleMs != 0 || consume.MaxTriggersPerEvent != 1 || consume.OperationCount != 1 || !consume.EventMatcher.RequiresAllType(blocked) || consume.EventMatcher != blockedMatcher || int(consume.OperationStart) >= len(session.Operations) {
		return false
	}
	remove := session.Operations[consume.OperationStart]
	return remove.OwnerProviderIndex == int(index) && remove.Operation == "expire_provider" && remove.Target == "self" && remove.ProviderRefFromEvent && remove.ProviderRef == "" && !remove.HasAmount && !remove.HasCondition
}
