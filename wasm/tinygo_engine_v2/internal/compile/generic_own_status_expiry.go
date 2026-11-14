package compile

import (
	"math"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func validateOwnStatusExpiry(op model.OperationDefinition, path string, ownerProviderIndex int, ctx *genericCompileContext) {
	if ownerProviderIndex < 0 || op.Target != model.SelectorSelf || op.ProviderRef != "" || op.ProviderRefFromEvent ||
		op.Amount != nil || op.Condition != nil || op.ValuePolicy != "" || op.AbilityRef != "" || len(op.Types) != 0 || op.EventType != "" {
		ctx.collector.addError(model.GenericErrFormulaTypeError, path, "definition expiry requires an owned self process status without instance, amount or condition", op.ProviderDefinitionRef)
	}
	ctx.validateForeignProviderRuntime(op.ProviderDefinitionRef, path)
}

func pureFiniteOwnSlow(provider planbundle.CompiledProvider, ctx *genericCompileContext) bool {
	lifecycle := provider.Lifecycle
	if provider.Kind != "status" || provider.SkillKey == "" || !provider.TypeSet.Empty() || provider.AbilityCount != 0 ||
		len(provider.Listeners)+len(provider.StateFields)+len(provider.Processes)+len(provider.Modifiers) != 0 ||
		provider.ShieldDefinitionRef != "" || provider.AmmoBinding != nil || provider.NeedsElapsedTime ||
		lifecycle == nil || !lifecycle.HasDuration || lifecycle.MaxStacks != 1 || lifecycle.RefreshPolicy != model.RefreshPolicyReplace ||
		lifecycle.InstanceScope != model.InstanceScopeSourceTarget || lifecycle.TickIntervalMs != 0 || len(provider.StatusContributions) != 1 {
		return false
	}
	duration, fixed := ctx.formulas.FoldStatic(lifecycle.DurationProgram)
	if !fixed || math.IsNaN(duration) || math.IsInf(duration, 0) || duration <= 0 || duration > 9007199254740991 || math.Trunc(duration) != duration {
		return false
	}
	contribution := provider.StatusContributions[0]
	if contribution.StatusKey == "" || contribution.StatusKind != model.StatusKindMovementSlow || !contribution.HasStrength || contribution.MomentEvaluation {
		return false
	}
	strength, fixed := ctx.formulas.FoldStatic(contribution.StrengthProgram)
	return fixed && !math.IsNaN(strength) && !math.IsInf(strength, 0) && strength >= 0 && strength <= 1
}

func ownedProcessOperation(provider planbundle.CompiledProvider, index int) bool {
	for _, process := range provider.Processes {
		for _, moment := range process.MomentOperations {
			if index >= int(moment.OperationStart) && index < int(moment.OperationStart)+int(moment.OperationCount) {
				return true
			}
		}
	}
	return false
}

func finalizeOwnStatusExpiry(ctx *genericCompileContext) {
	installed := false
	for index, operation := range ctx.session.Operations {
		if operation.Operation != "expire_provider" || operation.ProviderDefinitionRef == "" {
			continue
		}
		fail := func(message string) {
			ctx.collector.addError(model.GenericErrFormulaTypeError, operation.Path, message, operation.ProviderDefinitionRef)
		}
		target, exists := ctx.providerKeyIndex[operation.ProviderDefinitionRef]
		owner := operation.OwnerProviderIndex
		if !exists || owner < 0 || owner >= len(ctx.session.Providers) {
			fail("definition expiry has no complete owned source")
			continue
		}
		parent, provider := ctx.session.Providers[owner], ctx.session.Providers[target]
		if parent.SkillKey == "" || parent.SkillKey != provider.SkillKey || !pureFiniteOwnSlow(provider, ctx) ||
			!ownedProcessOperation(parent, index) || !uniqueApplyingSourceMount(ctx, operation.ProviderDefinitionRef, owner) {
			fail("definition expiry requires one actual applying mount and a pure same-skill finite own process slow")
			continue
		}
		valid := true
		for applyingIndex, applying := range ctx.session.Operations {
			if applying.Operation == "apply_provider" && applying.ProviderDefinitionRef == operation.ProviderDefinitionRef &&
				!ownedProcessOperation(parent, applyingIndex) {
				valid = false
			}
		}
		if !valid {
			fail("all own slow applications must belong to the same actual process source")
			continue
		}
		// 使用现有同帧效果投影，施加与移除都保留当前暂存顺序；不把状态改成属性修正。
		ctx.session.Providers[target].AtomicDynamic = true
		ctx.session.HasProviderDurationChange = true
		installed = true
	}
	if installed {
		// 同帧可组合另一项纯静态普通减速，投影保留实际贡献；不授予额外移除权限。
		for index, provider := range ctx.session.Providers {
			if pureFiniteOwnSlow(provider, ctx) {
				ctx.session.Providers[index].AtomicDynamic = true
			}
		}
	}
}
