package compile

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

type admissionSpellMount struct {
	key   plan.StaticSourceMountKey
	count int
}

type admissionBoundListener struct {
	index, count int
}

// BuildStaticAdmissionFacts 注记已完成校验的只读计划。形态不符只留下空凭证，由原运行分支裁决。
// 人工构造的测试计划也使用同一分析。
func BuildStaticAdmissionFacts(session *plan.CompiledSession) {
	mounts := make(map[plan.StaticSourceMountKey][]uint16)
	spellMounts := make([]admissionSpellMount, len(session.Providers))
	for _, actor := range session.Combatants {
		for _, mount := range actor.ProviderMounts {
			key := plan.StaticSourceMountKey{Owner: actor.Key, Reference: mount.ProviderRef}
			mounts[key] = append(mounts[key], mount.DefinitionIndex)
			slot := &spellMounts[mount.DefinitionIndex]
			slot.key, slot.count = key, slot.count+1
		}
	}
	for index := range session.Providers {
		provider := &session.Providers[index]
		provider.AdmissionFacts = plan.StaticProviderAdmissionFacts{}
		if provider.HasCooldownStateExpiry {
			provider.AdmissionFacts.CooldownExpirySource = staticCooldownExpirySource(*provider)
			if provider.AdmissionFacts.CooldownExpirySource {
				provider.AdmissionFacts.CooldownExpiryClosure = staticCooldownExpiryClosure(session, *provider)
			}
		} else if provider.HasStateOnExpire {
			provider.AdmissionFacts.StateExpiry = staticStateExpirySource(session, *provider)
		}
		for mi := range provider.Modifiers {
			modifier := &provider.Modifiers[mi]
			modifier.AdmissionFacts = plan.StaticModifierAdmissionFacts{
				FiniteFinalAttribute:    finiteFinalAttributePolicy(session.Formulas, *modifier),
				StaticIncomingReduction: staticIncomingDamageReductionModifier(session.Formulas, *modifier),
				GroupedDamageSource:     groupedDamageSourceModifier(session.Formulas, *modifier),
			}
		}
	}
	for index := range session.Operations {
		operation := &session.Operations[index]
		if operation.Operation == model.OperationKindStartPassiveProcess {
			operation.PassiveProcessAdmission = staticPassiveProcess(session, *operation)
		}
	}

	bound := make(map[plan.StaticSourceMountKey]admissionBoundListener)
	var heals map[plan.SettledHealAdmissionKey]bool
	var expiryWrites map[string]map[int]struct{}
	for index := range session.Listeners {
		listener := &session.Listeners[index]
		listener.AdmissionFacts = staticAdmissionListener(session, *listener)
		key := plan.StaticSourceMountKey{Owner: listener.OwnerCombatantKey, Reference: listener.OwnerProviderRef}
		if len(mounts[key]) == 0 {
			continue
		}
		entry := bound[key]
		bound[key] = admissionBoundListener{index: index, count: entry.count + 1}
		recordSettledHeal(session, *listener, &heals)
		if !listener.AdmissionFacts.ExpiryDamageListener {
			continue
		}
		for _, providerIndex := range mounts[key] {
			provider := session.Providers[providerIndex]
			if !provider.AdmissionFacts.StateExpiry || !staticExpiryStateWrites(session, provider, *listener) {
				continue
			}
			if expiryWrites == nil {
				expiryWrites = make(map[string]map[int]struct{})
			}
			if expiryWrites[provider.ProviderKey] == nil {
				expiryWrites[provider.ProviderKey] = make(map[int]struct{})
			}
			expiryWrites[provider.ProviderKey][index] = struct{}{}
		}
	}

	var spells map[string]plan.CompiledListener
	for index, mount := range spellMounts {
		entry := bound[mount.key]
		if mount.count != 1 || entry.count != 1 {
			continue
		}
		provider, listener := session.Providers[index], session.Listeners[entry.index]
		if staticSpellShieldClosure(session, index, provider, mount.key.Owner, mount.key.Reference, listener) {
			if spells == nil {
				spells = make(map[string]plan.CompiledListener)
			}
			spells[provider.ProviderKey] = listener
		}
	}
	session.AdmissionFacts = plan.NewStaticAdmissionFacts(spells, heals, mounts, expiryWrites)
}

func staticPassiveProcess(session *plan.CompiledSession, operation plan.CompiledOperation) plan.PassiveProcessAdmission {
	if operation.Target != model.SelectorSelf || operation.OwnerProviderIndex < 0 || operation.OwnerProviderIndex >= len(session.Providers) {
		return plan.PassiveProcessOutsideProvider
	}
	provider := session.Providers[operation.OwnerProviderIndex]
	if operation.PassiveProcessIndex < 0 || operation.PassiveProcessIndex >= len(provider.Processes) {
		return plan.PassiveProcessMissingProcess
	}
	process := provider.Processes[operation.PassiveProcessIndex]
	if process.EntryKind != model.ProcessEntrySkillHitPassive || process.InitialAbilityIndex >= 0 || len(process.Costs) != 0 || process.Cooldown != nil {
		return plan.PassiveProcessInvalidEntry
	}
	return plan.PassiveProcessComplete
}

func staticAdmissionListener(session *plan.CompiledSession, listener plan.CompiledListener) plan.StaticListenerAdmissionFacts {
	types := session.RuntimeTypes
	owner, hasOwner := types.SourceOwner.Lookup()
	attack, hasAttack := types.BasicAttackHit.Lookup()
	skill, hasSkill := types.SkillHit.Lookup()
	owned := hasOwner && listener.EventMatcher.RequiresAllType(owner)
	skillHit := hasSkill && listener.EventMatcher.RequiresAllType(skill)
	sourceOwned := owned && listener.OwnerCombatantKey == model.SelectorSource
	settled, hasSettled := types.DamageInstance.Lookup()
	damage, hasDamage := types.DamageTaken.Lookup()
	receiver, hasReceiver := types.TargetOwner.Lookup()
	return plan.StaticListenerAdmissionFacts{
		SettledDamageHeal:       owned && hasSettled && listener.EventMatcher.RequiresAllType(settled) && !listener.HasOncePerUse,
		PassiveSkillHit:         owned && skillHit,
		OwnAttackCooldownSet:    sourceOwned && hasAttack && listener.EventMatcher.RequiresAllType(attack),
		OwnSkillCooldownSet:     sourceOwned && skillHit,
		LinkedShieldInitializer: staticLinkedShieldInitialization(session, listener),
		ExpiryDamageListener: hasDamage && hasReceiver && listener.EventMatcher.RequiresAllType(damage) &&
			listener.EventMatcher.RequiresAllType(receiver) && listener.HasCondition && !listener.HasOncePerUse,
	}
}

func recordSettledHeal(session *plan.CompiledSession, listener plan.CompiledListener, heals *map[plan.SettledHealAdmissionKey]bool) {
	if !listener.AdmissionFacts.SettledDamageHeal {
		return
	}
	for index := int(listener.OperationStart); index < int(listener.OperationStart)+int(listener.OperationCount); index++ {
		op := session.Operations[index]
		if listener.OperationCount == 1 {
			recordSettledHealOperation(session, listener, index, heals)
		}
		if op.Operation != model.OperationKindStartPassiveProcess || op.PassiveProcessAdmission != plan.PassiveProcessComplete ||
			!listener.AdmissionFacts.PassiveSkillHit {
			continue
		}
		// 时点复用原监听的匹配和能力参数，操作范围取其自己的范围。
		for _, moment := range session.Providers[op.OwnerProviderIndex].Processes[op.PassiveProcessIndex].MomentOperations {
			if moment.OperationCount == 1 {
				recordSettledHealOperation(session, listener, int(moment.OperationStart), heals)
			}
		}
	}
}

func recordSettledHealOperation(session *plan.CompiledSession, listener plan.CompiledListener, index int, heals *map[plan.SettledHealAdmissionKey]bool) {
	operation := session.Operations[index]
	if operation.Operation != "heal" || !operation.HasAmount {
		return
	}
	key := plan.SettledHealAdmissionKey{AbilityIndex: listener.SourceAbilityIndex, OperationIndex: index}
	if _, found := (*heals)[key]; found {
		return
	}
	if *heals == nil {
		*heals = make(map[plan.SettledHealAdmissionKey]bool)
	}
	(*heals)[key] = staticSettledEventHeal(session, listener.SourceAbilityIndex, operation)
}
