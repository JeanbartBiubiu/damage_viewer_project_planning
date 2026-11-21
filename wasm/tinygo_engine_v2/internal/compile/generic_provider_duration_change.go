package compile

import (
	"math"
	"strings"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func validateProviderDurationChangeOperation(op model.OperationDefinition, path string, ownerProviderIndex int, ctx *genericCompileContext) {
	if ownerProviderIndex < 0 || op.Target != model.SelectorSelf || op.ValuePolicy != "ensure_remaining" || op.ProviderDefinitionRef == "" || op.Amount == nil ||
		op.ProviderRef != "" || op.ProviderRefFromEvent || op.AbilityRef != "" || op.Condition != nil || len(op.Types) != 0 {
		ctx.collector.addError(model.GenericErrFormulaTypeError, path, "provider duration change requires an owned self definition, static amount and ensure_remaining", op.ProviderDefinitionRef)
	}
	ctx.validateForeignProviderRuntime(op.ProviderDefinitionRef, path)
}

func pureFiniteOwnDurationProvider(provider planbundle.CompiledProvider, ctx *genericCompileContext) bool {
	lifecycle := provider.Lifecycle
	if provider.Kind != "status" || !provider.TypeSet.Empty() || provider.AbilityCount != 0 || len(provider.Listeners)+len(provider.StateFields)+len(provider.Processes)+len(provider.StatusContributions) != 0 ||
		provider.ShieldDefinitionRef != "" || provider.AmmoBinding != nil || provider.NeedsElapsedTime || len(provider.Modifiers) == 0 || lifecycle == nil || !lifecycle.HasDuration ||
		lifecycle.MaxStacks != 1 || lifecycle.RefreshPolicy != model.RefreshPolicyReplace || lifecycle.InstanceScope != model.InstanceScopeSourceTarget || lifecycle.TickIntervalMs != 0 {
		return false
	}
	duration, static := ctx.formulas.FoldStatic(lifecycle.DurationProgram)
	if !static || math.IsNaN(duration) || math.IsInf(duration, 0) || duration <= 0 || duration > 9007199254740991 || math.Trunc(duration) != duration {
		return false
	}
	for _, modifier := range provider.Modifiers {
		key, own := strings.CutPrefix(modifier.Target, "self.attr.")
		flat := modifier.ValuePolicy == "add" && modifier.Stage == ""
		percent := (modifier.ValuePolicy == "add_percent" || modifier.ValuePolicy == "percent_add") && modifier.Stage == ""
		total := modifier.ValuePolicy == "multiply" && modifier.Stage == "total"
		complement := modifier.ValuePolicy == "complement_multiply" && modifier.Stage == "total"
		if !own || key == "" || key == "hp" || strings.Contains(key, ".") || modifier.Kind != "attribute" || (!flat && !percent && !total && !complement) ||
			modifier.HasCondition || !modifier.HasValue || modifier.Command != "" || modifier.Channel != "" || modifier.HealDirection != "" || modifier.HealCategory != "" || modifier.HealGroupKey != "" || modifier.HealGroupCalculationMode != "" {
			return false
		}
		value, fixed := ctx.formulas.FoldStatic(modifier.ValueProgram)
		if !fixed || math.IsNaN(value) || math.IsInf(value, 0) || total && value <= 0 || complement && (value < 0 || value > 1) {
			return false
		}
	}
	return true
}

// 全部施加操作都须由同一个真实来源挂载拥有，未挂载的额外入口也不能忽略。
func uniqueApplyingSourceMount(ctx *genericCompileContext, definition string, ownerIndex int) bool {
	if ownerIndex < 0 || ownerIndex >= len(ctx.session.Providers) {
		return false
	}
	mountCount := 0
	for _, actor := range ctx.session.Combatants {
		for _, mount := range actor.ProviderMounts {
			if int(mount.DefinitionIndex) == ownerIndex {
				mountCount++
			}
		}
	}
	if mountCount != 1 {
		return false
	}
	found := false
	for _, operation := range ctx.session.Operations {
		if operation.Operation != "apply_provider" || operation.ProviderDefinitionRef != definition {
			continue
		}
		found = true
		if operation.OwnerProviderIndex != ownerIndex || (operation.Target != model.SelectorSelf && operation.Target != model.SelectorSource) {
			return false
		}
	}
	return found
}

// Every target definition is reachable from exactly one actual applying mount.
// ProviderInstance does not preserve its original parent mount, so admitting
// shared applying mounts here would let one source renew another's instance.
func finalizeProviderDurationChanges(ctx *genericCompileContext) {
	for _, operation := range ctx.session.Operations {
		if operation.Operation != "provider_duration_change" {
			continue
		}
		fail := func(message string) {
			ctx.collector.addError(model.GenericErrFormulaTypeError, operation.Path, message, operation.ProviderDefinitionRef)
		}
		index, exists := ctx.providerKeyIndex[operation.ProviderDefinitionRef]
		if !exists || operation.OwnerProviderIndex < 0 || operation.OwnerProviderIndex >= len(ctx.session.Providers) {
			fail("provider duration change has no owned complete target definition")
			continue
		}
		provider := &ctx.session.Providers[index]
		parent := ctx.session.Providers[operation.OwnerProviderIndex]
		amount, static := ctx.formulas.FoldStatic(operation.AmountProgram)
		if !operation.HasAmount || !static || math.IsNaN(amount) || math.IsInf(amount, 0) || amount < 0 || amount > 9007199254740991 || math.Trunc(amount) != amount ||
			parent.SkillKey == "" || parent.SkillKey != provider.SkillKey || !pureFiniteOwnDurationProvider(*provider, ctx) {
			fail("provider duration change requires static safe milliseconds and one pure same-skill finite own attribute instance")
			continue
		}
		if !uniqueApplyingSourceMount(ctx, operation.ProviderDefinitionRef, operation.OwnerProviderIndex) {
			fail("renewable definition requires exactly one actual applying source mount shared with its duration operation")
			continue
		}
		provider.AtomicDynamic = true
		duration, _ := ctx.formulas.FoldStatic(provider.Lifecycle.DurationProgram)
		provider.StaticDurationMs = int64(duration)
		ctx.session.Features |= planbundle.FeatureProviderDurationChange
		provider.NeedsModifierExpiry = true
		ctx.session.Features |= planbundle.FeatureFiniteModifierExpiry
	}
}
