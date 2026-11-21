package compile

import (
	"strings"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

func compileShieldLifecycleBinding(op model.OperationDefinition, path string, owner int, compiled *plan.CompiledOperation, ctx *genericCompileContext) {
	ref := op.ShieldLifecycleProviderDefinitionRef
	if ref == "" {
		return
	}
	p := path + ".shieldLifecycleProviderDefinitionRef"
	add := ctx.collector.addError
	if op.Operation != "shield" {
		add(model.GenericErrUnknownRef, p, "shield lifecycle binding is only supported on shield operations", ref)
		return
	}
	if strings.TrimSpace(op.ShieldRef) == "" {
		add(model.GenericErrMissingRequiredField, path+".shieldRef", "linked shield requires an explicit static definition reference", ref)
	}
	index, exists := ctx.providerKeyIndex[ref]
	if !exists {
		add(model.GenericErrUnknownRef, p, "unknown shield lifecycle provider definition", ref)
		return
	}
	if int(index) == owner {
		add(model.GenericErrUnknownRef, p, "a shield cannot own its executing provider", ref)
	}
	provider := &ctx.session.Providers[index]
	if provider.ShieldDefinitionRef == "" || provider.ShieldDefinitionRef != op.ShieldRef {
		add(model.GenericErrUnknownRef, p, "shield operation must match the provider's explicit linkedShieldDefinitionRef", ref)
	}
	if provider.Lifecycle != nil && (provider.Lifecycle.MaxStacks > 1 || provider.Lifecycle.RefreshPolicy != model.RefreshPolicyReplace) {
		add(model.GenericErrUnknownRef, p, "linked shield provider requires a single layer with replace refresh", ref)
	}
	ctx.validateForeignProviderRuntime(ref, p)
	compiled.HasShieldLifecycleProvider = true
	compiled.ShieldLifecycleProviderIndex = index
}

func finalizeShieldLifecycleBindings(req model.CompileRequest, ctx *genericCompileContext) {
	add := ctx.collector.addError
	type binding struct {
		provider uint16
		target   string
	}
	definitions := map[string]binding{}
	for i, provider := range ctx.session.Providers {
		if provider.ShieldDefinitionRef == "" {
			continue
		}
		ctx.session.Features |= plan.FeatureShieldLifecycle
		if strings.TrimSpace(provider.ShieldDefinitionRef) == "" || strings.ContainsAny(provider.ShieldDefinitionRef, "[]\r\n") {
			add(model.GenericErrUnknownRef, "sharedProviders["+itoa(i)+"].linkedShieldDefinitionRef", "linked shield definition reference is invalid", provider.ShieldDefinitionRef)
		}
		if _, exists := definitions[provider.ShieldDefinitionRef]; exists {
			add(model.GenericErrUnknownRef, "sharedProviders["+itoa(i)+"].linkedShieldDefinitionRef", "linked shield definition must have one unique provider definition", provider.ShieldDefinitionRef)
		}
		definitions[provider.ShieldDefinitionRef] = binding{provider: uint16(i)}
	}
	for _, op := range ctx.session.Operations {
		if !op.HasShieldLifecycleProvider {
			continue
		}
		ctx.session.Features |= plan.FeatureShieldLifecycle
		provider := &ctx.session.Providers[op.ShieldLifecycleProviderIndex]
		if old, found := definitions[op.ShieldRef]; found && (old.provider != op.ShieldLifecycleProviderIndex || (old.target != "" && old.target != op.Target)) {
			add(model.GenericErrUnknownRef, op.Path+".shieldRef", "shield definition must have one lifecycle provider and target selector", op.ShieldRef)
		}
		definitions[op.ShieldRef] = binding{op.ShieldLifecycleProviderIndex, op.Target}
		if provider.ShieldDefinitionRef != "" && provider.ShieldDefinitionRef != op.ShieldRef {
			add(model.GenericErrUnknownRef, op.Path+".shieldLifecycleProviderDefinitionRef", "lifecycle provider belongs to a different shield definition", provider.ProviderKey)
		}
		provider.ShieldDefinitionRef = op.ShieldRef
	}
	// A lifecycle-owned definition cannot also be mounted or created independently:
	// otherwise snapshots could contain a provider without its sole owning shield.
	for _, combatant := range ctx.session.Combatants {
		for _, mount := range combatant.ProviderMounts {
			if ctx.session.Providers[mount.DefinitionIndex].ShieldDefinitionRef != "" {
				add(model.GenericErrUnknownRef, "combatants.providers", "shield lifecycle provider cannot be initially mounted", mount.ProviderRef)
			}
		}
	}
	for _, op := range ctx.session.Operations {
		if op.Operation == "apply_provider" {
			if index, exists := ctx.providerKeyIndex[op.ProviderDefinitionRef]; exists && ctx.session.Providers[index].ShieldDefinitionRef != "" {
				add(model.GenericErrUnknownRef, op.Path+".providerDefinitionRef", "shield lifecycle provider can only be created by its shield", op.ProviderDefinitionRef)
			}
		}
		if op.HasShieldLifecycleProvider && op.OwnerProviderIndex >= 0 && ctx.session.Providers[op.OwnerProviderIndex].ShieldDefinitionRef != "" {
			add(model.GenericErrUnknownRef, op.Path+".shieldLifecycleProviderDefinitionRef", "nested shield lifecycle providers are not supported", op.ShieldRef)
		}
	}
	for i, provider := range ctx.session.Providers {
		if provider.Lifecycle != nil && provider.Lifecycle.AllowsSourceTargetReuse() && !provider.Lifecycle.HasDuration && provider.ShieldDefinitionRef == "" {
			add(model.GenericErrMissingRequiredField, "sharedProviders["+itoa(i)+"].lifecycle.durationMs", "source_target requires a positive duration formula", req.SharedProviders[i].ProviderKey)
		}
	}
	allowedReads := map[formula.GenericProgramID]bool{}
	for _, op := range ctx.session.Operations {
		if op.OwnerProviderIndex < 0 {
			continue
		}
		if op.HasAmount {
			allowedReads[op.AmountProgram] = true
		}
		if op.HasCondition {
			allowedReads[op.ConditionProgram] = true
		}
		if op.HasShieldDuration {
			allowedReads[op.ShieldDurationProgram] = true
		}
		if op.SkillHit != nil {
			for _, candidate := range op.SkillHit.Candidates {
				if candidate.HasParticipation {
					allowedReads[candidate.ParticipationProgram] = true
				}
			}
		}
	}
	for _, ability := range ctx.session.Abilities {
		if ability.HasCastCondition {
			allowedReads[ability.CastConditionProgram] = true
		}
	}
	for _, provider := range ctx.session.Providers {
		for _, listener := range provider.Listeners {
			if listener.HasCondition {
				allowedReads[listener.ConditionProgram] = true
			}
		}
	}
	for programIndex := 0; programIndex < ctx.formulas.Count(); programIndex++ {
		program := ctx.formulas.Info(formula.GenericProgramID(programIndex))
		for instructionIndex, instruction := range ctx.formulas.Instructions(formula.GenericProgramID(programIndex)) {
			if instruction.Op != formula.GenericOpRead || instruction.ReadKind != formula.ReadLinkedShieldPresent {
				continue
			}
			binding, found := definitions[instruction.ReadKey]
			if !found {
				add(model.GenericErrUnknownRef, program.Key, "linked shield presence requires a compiled shield definition", instruction.ReadKey)
				continue
			}
			if !allowedReads[formula.GenericProgramID(programIndex)] || !strings.HasPrefix(program.Key, "sharedProviders[") {
				add(model.GenericErrFormulaTypeError, program.Key, "linked shield presence requires its actual source provider context", instruction.ReadKey)
				continue
			}
			ctx.bindFormulaRead(formula.GenericProgramID(programIndex), instructionIndex, binding.provider)
			ctx.session.Features |= plan.FeatureLinkedShieldReads
		}
	}
}
