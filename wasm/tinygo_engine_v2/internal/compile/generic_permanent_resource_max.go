package compile

import (
	"tinygo_engine_v2/internal/base/typeset"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

// This is a cold initialization capability, never a general permanent apply.
func finalizePermanentResourceMax(ctx *genericCompileContext) {
	initialization, declared := ctx.session.RuntimeTypes.SourceInitialized.Lookup()
	ownerType, ownerDeclared := ctx.session.RuntimeTypes.SourceOwner.Lookup()
	var actualEvent typeset.TypeSet
	if declared {
		actualEvent.Add(initialization)
	}
	if ownerDeclared {
		actualEvent.Add(ownerType)
	}
	if targetOwner, ok := ctx.session.RuntimeTypes.TargetOwner.Lookup(); ok {
		actualEvent.Add(targetOwner)
	}
	for pi, effect := range ctx.session.Providers {
		if !effect.PermanentResourceMax {
			continue
		}
		fail := func(path, message string) {
			ctx.collector.addError(model.GenericErrRuntimeInvariantFailed, path, message, effect.ProviderKey)
		}
		for _, actor := range ctx.session.Combatants {
			for _, mount := range actor.ProviderMounts {
				if int(mount.DefinitionIndex) == pi {
					fail("combatants.providers", "permanent resource maximum cannot be initially mounted")
				}
			}
		}
		applications := 0
		for oi := range ctx.session.Operations {
			op := &ctx.session.Operations[oi]
			if op.ProviderDefinitionRef != effect.ProviderKey {
				continue
			}
			valid := declared && ownerDeclared && op.Operation == "apply_provider" && op.Target == model.SelectorSelf &&
				!op.HasCondition && !op.HasAmount && !op.ProviderRefFromEvent && op.ProviderRef != "" &&
				op.OwnerProviderIndex >= 0 && op.OwnerProviderIndex < len(ctx.session.Providers)
			if !valid {
				fail(op.Path, "permanent resource maximum requires its unconditional source-initialization self application")
				continue
			}
			parent := ctx.session.Providers[op.OwnerProviderIndex]
			valid = parent.Kind == "character" && parent.StableID != "" && parent.SkillKey == effect.SkillKey &&
				parent.Lifecycle == nil && len(parent.StateFields)+len(parent.StatusContributions)+len(parent.Modifiers) == 0
			bound := 0
			for _, listener := range ctx.session.Listeners {
				start, end := int(listener.OperationStart), int(listener.OperationStart)+int(listener.OperationCount)
				if oi < start || oi >= end {
					continue
				}
				owned := valid && listener.OwnerCombatantKey != "" && listener.OwnerProviderRef != "" && !listener.HasAbilityRef &&
					listener.SourceAbilityIndex < 0 && !listener.HasCondition && !listener.HasOncePerUse && listener.PerCastThrottleMs == 0 &&
					listener.MaxTriggersPerEvent == 1 && listener.EventMatcher.RequiresAllType(initialization) && listener.EventMatcher.RequiresAllType(ownerType) && listener.EventMatcher.Match(actualEvent)
				if parent.AbilityCount > 0 || len(parent.Processes) != 0 {
					planned := false
					for _, binding := range ctx.session.SkillActionBindings {
						planned = planned || binding.Source == listener.OwnerCombatantKey && binding.ProviderRef == listener.OwnerProviderRef && binding.SkillKey == parent.SkillKey && ctx.session.Abilities[binding.InitialAbilityIndex].ProviderIndex == uint16(op.OwnerProviderIndex)
					}
					owned = owned && planned && len(parent.Processes) == 1
				}
				if !owned {
					fail(op.Path, "permanent resource maximum requires its real mounted natural source initializer")
					continue
				}
				duplicate := false
				for _, existing := range ctx.session.PermanentResourceMax {
					duplicate = duplicate || existing.Owner == listener.OwnerCombatantKey && existing.ProviderIndex == uint16(pi)
				}
				if duplicate {
					fail(op.Path, "permanent resource maximum requires one unique actual initialization consumer per owner")
					continue
				}
				bound++
				ctx.session.PermanentResourceMax = append(ctx.session.PermanentResourceMax, plan.CompiledPermanentResourceMax{
					Owner: listener.OwnerCombatantKey, SourceProviderRef: listener.OwnerProviderRef, SourceDefinitionRef: parent.ProviderKey,
					ListenerKey: listener.ListenerKey, ProviderRef: op.ProviderRef, OperationIndex: uint16(oi), ProviderIndex: uint16(pi),
				})
			}
			if bound == 0 {
				fail(op.Path, "permanent resource maximum has no real mounted initialization consumer")
			} else {
				op.ColdResourceMax = true
				applications += bound
			}
		}
		if applications == 0 {
			fail("sharedProviders["+itoa(pi)+"]", "permanent resource maximum has no source initialization application")
		}
	}
}

func permanentHealthStaticOwner(registry formula.GenericRegistry, id formula.GenericProgramID, skill string, depth int) bool {
	if depth > 32 || int(id) >= len(registry.Programs) {
		return false
	}
	program := registry.Programs[id]
	if binding := program.NamedBinding; binding != nil && binding.Scope() == "skill" && binding.SkillKey() != skill {
		return false
	}
	for _, instruction := range program.Instr {
		if instruction.Op == formula.GenericOpRef && !permanentHealthStaticOwner(registry, formula.GenericProgramID(instruction.RefIndex), skill, depth+1) {
			return false
		}
	}
	return true
}
