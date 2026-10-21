package compile

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

func validateReceivedShieldReadContext(deps []formula.GenericInstr, path string, ctx *genericCompileContext) {
	for _, read := range deps {
		if read.ReadKind != formula.ReadReceivedLinkedShieldAbsorbed {
			continue
		}
		valid := ctx.compilingListenerCondition && ctx.currentListener != nil
		damage, receiver := false, false
		if valid {
			for _, event := range ctx.currentListener.EventMatcher.All {
				damage = damage || event == model.EventTypeDamageTaken
				receiver = receiver || event == "event/target_owner"
			}
		}
		if !valid || !damage || !receiver {
			ctx.collector.addError(model.GenericErrFormulaTypeError, path, "linked shield absorption requires an original own damage_taken listener condition", read.ReadKey)
		}
	}
}

func finalizeReceivedShieldReads(ctx *genericCompileContext) {
	session := ctx.session
	allowed := map[formula.GenericProgramID]bool{}
	damage, hasDamage := session.RuntimeTypes.DamageTaken.Lookup()
	receiver, hasReceiver := session.RuntimeTypes.TargetOwner.Lookup()
	for _, listener := range session.Listeners {
		if !listener.HasCondition {
			continue
		}
		for _, read := range session.Formulas.ReadDependencies(listener.ConditionProgram) {
			if read.ReadKind != formula.ReadReceivedLinkedShieldAbsorbed {
				continue
			}
			path := "listeners." + listener.ListenerKey + ".condition"
			fail := func(message string) {
				ctx.collector.addError(model.GenericErrFormulaTypeError, path, message, read.ReadKey)
			}
			parent, mounts := -1, 0
			for _, actor := range session.Combatants {
				if actor.Key != listener.OwnerCombatantKey {
					continue
				}
				for _, mount := range actor.ProviderMounts {
					if mount.ProviderRef == listener.OwnerProviderRef {
						parent = int(mount.DefinitionIndex)
					}
				}
				if parent >= 0 {
					for _, mount := range actor.ProviderMounts {
						if int(mount.DefinitionIndex) == parent {
							mounts++
						}
					}
				}
			}
			if !hasDamage || !hasReceiver || !listener.EventMatcher.RequiresAllType(damage) || !listener.EventMatcher.RequiresAllType(receiver) || listener.OwnerProviderRef == "" || parent < 0 || parent >= len(session.Providers) || mounts != 1 {
				fail("linked shield absorption requires its unique actual receiver parent mount")
				continue
			}
			origin := session.Providers[parent]
			if (origin.Kind != "character" && origin.Kind != "build") || origin.Lifecycle != nil || origin.StableID == "" || origin.SkillKey == "" {
				fail("linked shield absorption requires a permanent natural skill source")
				continue
			}
			if listener.SourceAbilityIndex >= 0 {
				if listener.SourceAbilityIndex >= len(session.Abilities) {
					fail("received shield listener has no actual source ability")
					continue
				}
				ability := session.Abilities[listener.SourceAbilityIndex]
				if int(ability.ProviderIndex) != parent || ability.Kind != "passive_listener" || ability.SkillKey != origin.SkillKey {
					fail("received shield listener source ability belongs to another parent")
					continue
				}
			}
			end := int(listener.OperationStart) + int(listener.OperationCount)
			validRange := end <= len(session.Operations)
			if validRange {
				for _, operation := range session.Operations[int(listener.OperationStart):end] {
					validRange = validRange && operation.OwnerProviderIndex == parent
				}
			}
			if !validRange {
				fail("received shield listener operations belong to another parent")
				continue
			}
			index, definitions := -1, 0
			for i, provider := range session.Providers {
				if provider.ShieldDefinitionRef == read.ReadKey {
					index, definitions = i, definitions+1
				}
			}
			if definitions != 1 {
				fail("linked shield absorption requires one complete shield/lifecycle definition")
				continue
			}
			shield := &session.Providers[index]
			if shield.SkillKey != origin.SkillKey || shield.Lifecycle != nil && (shield.Lifecycle.MaxStacks != 1 || shield.Lifecycle.RefreshPolicy != model.RefreshPolicyReplace || shield.Lifecycle.InstanceScope != "") {
				fail("linked shield absorption requires the same skill's single own shield")
				continue
			}
			creators, valid := 0, true
			for _, operation := range session.Operations {
				if operation.ShieldRef != read.ReadKey && !(operation.HasShieldLifecycleProvider && int(operation.ShieldLifecycleProviderIndex) == index) {
					continue
				}
				creators++
				valid = valid && operation.Operation == "shield" && operation.HasShieldLifecycleProvider && int(operation.ShieldLifecycleProviderIndex) == index && operation.OwnerProviderIndex == parent && operation.Target == model.SelectorSelf
			}
			if !valid || creators == 0 || shield.HasReceivedShieldBinding && int(shield.ReceivedShieldParentIndex) != parent {
				fail("every referenced shield creator must belong to this actual self parent")
				continue
			}
			shield.HasReceivedShieldBinding, shield.ReceivedShieldParentIndex = true, uint16(parent)
			session.HasReceivedShieldReads = true
			allowed[listener.ConditionProgram] = true
		}
	}
	for i, program := range session.Formulas.Programs {
		for _, read := range session.Formulas.ReadDependencies(formula.GenericProgramID(i)) {
			if read.ReadKind == formula.ReadReceivedLinkedShieldAbsorbed && !allowed[formula.GenericProgramID(i)] && !program.DeclaredNamed {
				ctx.collector.addError(model.GenericErrFormulaTypeError, program.Key, "linked shield absorption is only authorized by a real mounted receiver listener condition", read.ReadKey)
			}
		}
		for j, instruction := range program.Instr {
			if instruction.Op != formula.GenericOpRead || instruction.ReadKind != formula.ReadReceivedLinkedShieldAbsorbed {
				continue
			}
			bound := false
			for index, provider := range session.Providers {
				if provider.HasReceivedShieldBinding && provider.ShieldDefinitionRef == instruction.ReadKey {
					instruction.ReferenceBound, instruction.RefIndex = true, uint16(index)
					session.Formulas.Programs[i].Instr[j] = instruction
					bound = true
					break
				}
			}
			if !bound {
				ctx.collector.addError(model.GenericErrUnknownRef, program.Key, "received shield read has no authorized own definition binding", instruction.ReadKey)
			}
		}
	}
	if session.HasReceivedShieldReads {
		for _, operation := range session.Operations {
			if operation.Operation == model.OperationKindRepeat {
				ctx.collector.addError(model.GenericErrFormulaTypeError, operation.Path, "received shield absorption cannot be mixed with copyable damage replay", operation.Ref)
			}
		}
	}
}
