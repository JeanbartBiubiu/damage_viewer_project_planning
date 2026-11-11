package compile

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

// 只标识完整共同公式中的拥有者生命读取，内部用途read保持原帧方向。
func ownsAuthoredHealthReads(mod plan.CompiledModifier, ctx *genericCompileContext) bool {
	if ctx.currentSkillKey == "" || mod.Kind != "attribute" || mod.ValuePolicy != "add" || mod.HasCondition || !mod.HasValue ||
		mod.Target == "self.attr.hp" || len(mod.Target) <= len("self.attr.") || mod.Target[:len("self.attr.")] != "self.attr." || mod.Stage != "" {
		return false
	}
	if _, static := ctx.formulas.FoldStatic(mod.ValueProgram); static {
		return false
	}
	if !ownedHealthSkillPrograms(ctx.formulas, mod.ValueProgram, ctx.currentSkillKey, 0) {
		return false
	}
	reads, supported := ctx.formulas.AttributeCacheDependencies(mod.ValueProgram)
	if !supported || len(reads) == 0 {
		return false
	}
	actual := false
	for _, read := range reads {
		if !read.AuthoredRead || read.ReadKind != formula.ReadSourceAttr ||
			(read.ReadKey != "hp.current" && read.ReadKey != "hp.max" && read.ReadKey != "hp.presence") {
			return false
		}
		actual = actual || read.ReadKey != "hp.presence"
	}
	return actual
}

// 这种永久动态修正只由真实来源初始化挂到自身，不能借普通apply/refresh
// 将作者来源偷换成承受者；新运行的既有初始化门禁继续拒绝恢复预挂实例。
func finalizeOwnedHealthModifiers(ctx *genericCompileContext) {
	initializationType, declared := ctx.session.RuntimeTypes.SourceInitialized.Lookup()
	ownerType, ownerDeclared := ctx.session.RuntimeTypes.SourceOwner.Lookup()
	for providerIndex, provider := range ctx.session.Providers {
		owned := false
		for _, modifier := range provider.Modifiers {
			owned = owned || modifier.OwnedHealthReads
		}
		if !owned {
			continue
		}
		fail := func(path, message string) {
			ctx.collector.addError(model.GenericErrRuntimeInvariantFailed, path, message, provider.ProviderKey)
		}
		path := "sharedProviders[" + itoa(providerIndex) + "]"
		if !declared || !ownerDeclared || provider.SkillKey == "" {
			fail(path, "owned health modifier requires its real source initialization event")
			continue
		}
		for _, actor := range ctx.session.Combatants {
			for _, mount := range actor.ProviderMounts {
				if int(mount.DefinitionIndex) == providerIndex {
					fail(path, "owned health modifier cannot be initially mounted or restored")
				}
			}
		}
		applications := 0
		for operationIndex, operation := range ctx.session.Operations {
			if operation.ProviderDefinitionRef != provider.ProviderKey {
				continue
			}
			valid := operation.Operation == "apply_provider" && operation.Target == model.SelectorSelf && !operation.HasCondition &&
				!operation.HasAmount && !operation.ProviderRefFromEvent && operation.ProviderRef != "" &&
				operation.OwnerProviderIndex >= 0 && operation.OwnerProviderIndex < len(ctx.session.Providers)
			if !valid {
				fail(operation.Path, "owned health modifier only accepts its initialization self application")
				continue
			}
			parent := ctx.session.Providers[operation.OwnerProviderIndex]
			valid = parent.SkillKey == provider.SkillKey && (parent.Kind == "character" || parent.Kind == "build") && parent.StableID != "" &&
				parent.AbilityCount == 0 && parent.Lifecycle == nil && len(parent.StateFields)+len(parent.StatusContributions)+len(parent.Processes)+len(parent.Modifiers) == 0
			mounted := false
			for _, actor := range ctx.session.Combatants {
				for _, mount := range actor.ProviderMounts {
					mounted = mounted || int(mount.DefinitionIndex) == operation.OwnerProviderIndex
				}
			}
			listenerOwns := false
			for _, listener := range parent.Listeners {
				start, end := int(listener.OperationStart), int(listener.OperationStart)+int(listener.OperationCount)
				if operationIndex < start || operationIndex >= end {
					continue
				}
				listenerOwns = !listener.HasCondition && !listener.HasAbilityRef && !listener.HasOncePerUse && listener.PerCastThrottleMs == 0 &&
					listener.MaxTriggersPerEvent == 1 && listener.EventMatcher.RequiresAllType(initializationType) && listener.EventMatcher.RequiresAllType(ownerType)
			}
			if !valid || !mounted || !listenerOwns {
				fail(operation.Path, "owned health modifier requires an actual same-skill unconditional source initializer")
				continue
			}
			applications++
		}
		if applications == 0 {
			fail(path, "owned health modifier has no mounted source initialization consumer")
		}
	}
}

func ownedHealthSkillPrograms(registry formula.Builder, id formula.GenericProgramID, skill string, depth int) bool {
	if depth > 32 || int(id) >= registry.Count() {
		return false
	}
	program := registry.Info(formula.GenericProgramID(id))
	if program.HasNamedBinding && (program.Scope != "skill" || program.SkillKey != skill) {
		return false
	}
	for _, instruction := range registry.Instructions(id) {
		if instruction.Op == formula.GenericOpRef && !ownedHealthSkillPrograms(registry, formula.GenericProgramID(instruction.RefIndex), skill, depth+1) {
			return false
		}
	}
	return true
}
