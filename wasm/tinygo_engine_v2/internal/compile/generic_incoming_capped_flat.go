package compile

import (
	"math"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

func validateIncomingCappedFlatShape(raw model.ModifierDefinition, mod plan.CompiledModifier, path string, ctx *genericCompileContext) {
	if !mod.HasMaximumReductionRatio && mod.Stage != "incoming_pre_mitigation" {
		return
	}
	if !mod.HasMaximumReductionRatio || math.IsNaN(mod.MaximumReductionRatio) || math.IsInf(mod.MaximumReductionRatio, 0) || mod.MaximumReductionRatio < 0 || mod.MaximumReductionRatio > 1 ||
		mod.Kind != "pipeline" || mod.Command != "damage" || mod.Stage != "incoming_pre_mitigation" || mod.Channel != "all_damage" || mod.Bucket != "all_instances" || mod.ValuePolicy != "subtract" ||
		raw.Target != "" || raw.Condition == nil || raw.ValueReadMode != "" || raw.CurrentValuePolicy != "" || raw.AffectedAbilityRefs != nil || raw.HealDirection != "" || raw.HealCategory != "" || raw.HealGroupKey != "" || raw.HealGroupCalculationMode != "" {
		ctx.collector.addError(model.GenericErrUnknownRef, path, "capped flat requires only a permanent incoming subtract, explicit [0,1] cap and one actual damage-type predicate", mod.ModifierKey)
	}
}

func cappedFlatValueOwned(mod plan.CompiledModifier, skill string, ctx *genericCompileContext) bool {
	if !mod.HasValue || !cappedFlatSkillPrograms(ctx.formulas, mod.ValueProgram, skill, 0) {
		return false
	}
	if value, fixed := ctx.formulas.FoldStatic(mod.ValueProgram); fixed {
		return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0
	}
	reads, supported := ctx.formulas.AttributeCacheDependencies(mod.ValueProgram)
	if !supported || len(reads) == 0 {
		return false
	}
	for _, read := range reads {
		if !read.AuthoredRead || read.ReadKind != formula.ReadSourceAttr {
			return false
		}
	}
	return true
}

// Check author bindings rather than prescribing an arithmetic AST. Dependency
// instructions alone cannot distinguish an actual BONUS binding from TOTAL-BASE.
func cappedFlatSkillPrograms(registry formula.Builder, id formula.GenericProgramID, skill string, depth int) bool {
	if depth > 32 || int(id) >= registry.Count() {
		return false
	}
	program := registry.Info(formula.GenericProgramID(id))
	if program.HasNamedBinding && (program.Scope != "skill" || program.SkillKey != skill) {
		return false
	}
	if program.HasAuthored {
		if !program.HasNamedBinding {
			return false
		}
		for _, input := range registry.DeclaredInputs(id) {
			binding := input.Binding
			if binding.Kind == "attribute" && (binding.Object != "source" || binding.View != "current_frame" || binding.ValueKind != "BONUS") {
				return false
			}
			if binding.Kind != "attribute" && binding.Kind != "parameter" {
				return false
			}
		}
	}
	for _, instruction := range registry.Instructions(id) {
		if instruction.Op == formula.GenericOpRef && !cappedFlatSkillPrograms(registry, formula.GenericProgramID(instruction.RefIndex), skill, depth+1) {
			return false
		}
	}
	return true
}

func rawCappedFlatInitializer(parent model.ProviderDefinition) (model.OperationDefinition, bool) {
	var listener model.ListenerDefinition
	found := false
	if len(parent.Listeners) == 1 {
		listener = parent.Listeners[0]
		found = true
	} else if len(parent.Listeners) != 0 {
		return model.OperationDefinition{}, false
	}
	for _, ability := range parent.Abilities {
		if ability.Kind == "active" {
			if ability.ListenerSpec != nil || ability.TickSpec != nil || ability.TargetExpirySpec != nil || len(ability.StateSchema) != 0 {
				return model.OperationDefinition{}, false
			}
			continue // The complete actual INITIAL binding is checked below.
		}
		if ability.Kind != "passive_listener" || ability.ListenerSpec == nil || ability.SkillKey != parent.SkillKey || ability.Cost != nil || ability.Cooldown != nil || ability.CastCondition != nil || ability.ProcessControl != nil || ability.TickSpec != nil || ability.TargetExpirySpec != nil || len(ability.Operations)+len(ability.Params)+len(ability.StateSchema) != 0 {
			return model.OperationDefinition{}, false
		}
		if found {
			return model.OperationDefinition{}, false
		}
		listener = *ability.ListenerSpec
		found = true
	}
	if !found {
		return model.OperationDefinition{}, false
	}
	matcher := listener.EventMatcher
	if len(matcher.All) != 2 || len(matcher.Any)+len(matcher.None) != 0 || listener.AbilityRef != "" || listener.Condition != nil || listener.OncePerUse != nil || listener.PerCastThrottleMs != 0 || listener.ChainLimitKey != "" || listener.MaxTriggersPerEvent != 1 || len(listener.Operations) != 1 {
		return model.OperationDefinition{}, false
	}
	init, owner := false, false
	for _, key := range matcher.All {
		init = init || key == model.EventTypeSourceInitialized
		owner = owner || key == "event/source_owner"
	}
	operation := listener.Operations[0]
	if !init || !owner || operation.Operation != "apply_provider" || operation.Target != model.SelectorSelf || operation.ProviderRef == "" || operation.ProviderDefinitionRef == "" {
		return operation, false
	}
	plain := operation
	plain.Operation, plain.Target, plain.ProviderDefinitionRef, plain.ProviderRef, plain.Ref = "", "", "", "", ""
	return operation, emptyHealingHitOperation(plain)
}

// The only additional members are the complete controls and hit abilities of
// one already validated INITIAL binding on this actual character mount.
func cappedFlatParentActiveClosure(parentIndex int, owner, providerRef string, ctx *genericCompileContext) bool {
	parent := ctx.session.Providers[parentIndex]
	if len(parent.Processes) == 0 {
		for i := int(parent.AbilityStart); i < int(parent.AbilityStart)+int(parent.AbilityCount); i++ {
			if ctx.session.Abilities[i].Kind != "passive_listener" {
				return false
			}
		}
		return true
	}
	if len(parent.Processes) != 1 {
		return false
	}
	var bound *plan.CompiledSkillActionBinding
	for i := range ctx.session.SkillActionBindings {
		binding := &ctx.session.SkillActionBindings[i]
		if binding.Source == owner && binding.ProviderRef == providerRef && binding.ProviderDefinitionRef == parent.ProviderKey && binding.SkillKey == parent.SkillKey {
			if bound != nil {
				return false
			}
			bound = binding
		}
	}
	if bound == nil || len(bound.Controls) != 1 || bound.Controls[0].Action != "INITIAL" || len(bound.ControlAbilityIndices) != 1 {
		return false
	}
	initial := ctx.session.Abilities[bound.InitialAbilityIndex]
	if int(initial.ProviderIndex) != parentIndex || initial.SkillKey != parent.SkillKey || initial.ProcessControl == nil || initial.ProcessControl.Action != "INITIAL" || initial.ProcessControl.ProcessIndex != 0 || initial.ProcessControl.UseRefFromEvent || parent.Processes[0].ProcessKey != bound.Controls[0].ProcessKey || parent.Processes[0].SkillKey != parent.SkillKey {
		return false
	}
	allowed := map[uint16]bool{bound.InitialAbilityIndex: true}
	for _, hit := range bound.HitBindings {
		ref, exists := ctx.session.AbilityRefIndex[hit.HitAbilityRef]
		if !exists || int(ref.ProviderIndex) != parentIndex || hit.ProcessKey != parent.Processes[0].ProcessKey {
			return false
		}
		allowed[ref.AbilityIndex] = true
	}
	for i := int(parent.AbilityStart); i < int(parent.AbilityStart)+int(parent.AbilityCount); i++ {
		ability := ctx.session.Abilities[i]
		if ability.Kind == "passive_listener" {
			if len(parent.Listeners) != 1 || parent.Listeners[0].SourceAbilityIndex != i {
				return false
			}
			continue
		}
		if ability.Kind != "active" || ability.SkillKey != parent.SkillKey || !allowed[uint16(i)] || ability.TickSpec != nil || ability.TargetExpirySpec != nil {
			return false
		}
	}
	return true
}

// Only an actual, sole character initializer can publish the permanent status.
// Rules, directly mounted statuses and active/cross-source applications never gain this admission.
func finalizeIncomingCappedFlatModifiers(req model.CompileRequest, ctx *genericCompileContext) {
	counts := map[string]int{}
	for providerIndex, provider := range ctx.session.Providers {
		for _, mod := range provider.Modifiers {
			if !mod.HasMaximumReductionRatio && mod.Stage != "incoming_pre_mitigation" {
				continue
			}
			path := "sharedProviders[" + itoa(providerIndex) + "]"
			fail := func(message string) {
				ctx.collector.addError(model.GenericErrRuntimeInvariantFailed, path, "capped flat: "+message, provider.ProviderKey)
			}
			if provider.Kind != "status" || provider.SkillKey == "" || provider.Lifecycle != nil || provider.AbilityCount != 0 || len(provider.Modifiers) != 1 || len(provider.Processes)+len(provider.Listeners)+len(provider.StateFields)+len(provider.StatusContributions)+len(provider.TargetTimings) != 0 || provider.ShieldDefinitionRef != "" || provider.AmmoBinding != nil || !provider.TypeSet.Empty() || !cappedFlatValueOwned(mod, provider.SkillKey, ctx) {
				fail("requires a pure permanent single modifier and its own static parameters/owner resistance reads")
				continue
			}
			if !mod.HasCondition || int(mod.ConditionProg) >= ctx.formulas.Count() {
				fail("requires one declared damage-type condition")
				continue
			}
			condition := ctx.formulas.Instructions(mod.ConditionProg)
			if len(condition) != 1 || condition[0].Op != formula.GenericOpRead || condition[0].ReadKind != formula.ReadDamageType {
				fail("only a single declared damage type is a valid filter")
				continue
			}
			for _, actor := range ctx.session.Combatants {
				for _, mount := range actor.ProviderMounts {
					if int(mount.DefinitionIndex) == providerIndex {
						fail("status cannot be pre-mounted")
					}
				}
			}
			applications := 0
			for _, operation := range ctx.session.Operations {
				if operation.ProviderDefinitionRef != provider.ProviderKey {
					continue
				}
				if operation.OwnerProviderIndex < 0 || operation.OwnerProviderIndex >= len(ctx.session.Providers) {
					fail("application lacks an actual character parent")
					continue
				}
				parent := ctx.session.Providers[operation.OwnerProviderIndex]
				var raw model.ProviderDefinition
				for _, candidate := range req.SharedProviders {
					if candidate.ProviderKey == parent.ProviderKey {
						raw = candidate
						break
					}
				}
				initial, valid := rawCappedFlatInitializer(raw)
				if !valid || initial.ProviderDefinitionRef != provider.ProviderKey || initial.ProviderRef != operation.ProviderRef || parent.Kind != "character" || parent.SkillKey != provider.SkillKey || parent.StableID == "" || parent.Lifecycle != nil || parent.AmmoBinding != nil || len(parent.Modifiers)+len(parent.StateFields)+len(parent.StatusContributions)+len(parent.TargetTimings) != 0 || len(parent.Listeners) != 1 || operation.Operation != "apply_provider" || operation.Target != model.SelectorSelf {
					fail("requires its sole unconditional same-skill character initialization application")
					continue
				}
				mounts := 0
				var source plan.CompiledIncomingCappedFlatSource
				for _, actor := range ctx.session.Combatants {
					for _, mount := range actor.ProviderMounts {
						if mount.ProviderRef == initial.ProviderRef {
							fail("initialized status reference cannot alias an existing parent mount")
						}
						if int(mount.DefinitionIndex) == operation.OwnerProviderIndex {
							mounts++
							source = plan.CompiledIncomingCappedFlatSource{Owner: actor.Key, ParentProviderRef: mount.ProviderRef, EffectProviderRef: initial.ProviderRef, ParentIndex: uint16(operation.OwnerProviderIndex), EffectIndex: uint16(providerIndex)}
						}
					}
				}
				if mounts != 1 || (source.Owner != model.SelectorSource && source.Owner != model.SelectorTarget) {
					fail("requires exactly one actual character owner mount")
					continue
				}
				if !cappedFlatParentActiveClosure(operation.OwnerProviderIndex, source.Owner, source.ParentProviderRef, ctx) {
					fail("parent active members require one complete actual same-owner INITIAL binding")
					continue
				}
				counts[source.Owner]++
				if counts[source.Owner] != 1 {
					fail("at most one capped flat source per owner")
				}
				ctx.session.IncomingCappedFlatSources = append(ctx.session.IncomingCappedFlatSources, source)
				applications++
				for _, other := range ctx.session.Operations {
					if other.ProviderRef == initial.ProviderRef && other.Path != operation.Path {
						fail("permanent status cannot have additional writers")
					}
				}
			}
			if applications != 1 {
				fail("requires exactly one real initialization producer")
			}
		}
	}
	for _, mod := range ctx.session.RuleModifiers {
		if mod.HasMaximumReductionRatio || mod.Stage == "incoming_pre_mitigation" {
			ctx.collector.addError(model.GenericErrRuntimeInvariantFailed, "rules.modifiers", "capped flat cannot be global", mod.ModifierKey)
		}
	}
}
