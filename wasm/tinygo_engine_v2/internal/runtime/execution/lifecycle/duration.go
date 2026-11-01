package lifecycle

import (
	"math"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

func (e *Executor) PrepareDurationExtension(operation plan.CompiledOperation, owner string, instances effectpkg.ProviderList, deadline, now int64) (Mutation, bool, *model.EngineError) {
	reference := ""
	previousExpiry := int64(0)
	for index := 0; index < instances.Len(); index++ {
		instance := instances.At(index)
		if instance.DefinitionRef != operation.ProviderDefinitionRef {
			continue
		}
		if instance.Owner != owner || instance.Source != owner {
			return Mutation{}, false, e.invariant(operation.Path, "provider duration change found a foreign instance owner", operation.ProviderDefinitionRef)
		}
		if instance.Expired(now) {
			continue
		}
		if instance.ExpireAt <= 0 || reference != "" {
			return Mutation{}, false, e.invariant(operation.Path, "provider duration change requires one active finite source instance", operation.ProviderDefinitionRef)
		}
		reference, previousExpiry = instance.ProviderRef, instance.ExpireAt
	}
	if reference == "" || deadline <= previousExpiry {
		return Mutation{}, false, nil
	}
	return Mutation{Kind: "ensure_remaining", DefinitionRef: operation.ProviderDefinitionRef,
		ProviderRef: reference, TargetKey: owner, SourceKey: owner, ExpireAt: deadline, HasExpireAt: true}, true, nil
}

func (e *Executor) DurationExtensionDeadline(operation plan.CompiledOperation, owner, source, provider string, now int64) (int64, *model.EngineError) {
	if !e.compiled.HasProviderDurationChange || operation.Target != model.SelectorSelf || operation.ValuePolicy != "ensure_remaining" ||
		owner != source || owner != model.SelectorSource || provider == "" || !operation.HasAmount {
		return 0, e.invariant(operation.Path, "provider duration change requires its actual source owner and complete definition", operation.ProviderDefinitionRef)
	}
	owned := false
	for _, actor := range e.compiled.Combatants {
		for _, mount := range actor.ProviderMounts {
			owned = owned || actor.Key == owner && mount.ProviderRef == provider && int(mount.DefinitionIndex) == operation.OwnerProviderIndex
		}
	}
	index, exists := e.FindDefinition(operation.ProviderDefinitionRef)
	if !owned || !exists || !e.compiled.Providers[index].AtomicDynamic {
		return 0, e.invariant(operation.Path, "provider duration change references an unknown or foreign applying source", operation.ProviderDefinitionRef)
	}
	amount, static := e.formulas.FoldStatic(operation.AmountProgram)
	deadline, safe := actionpkg.ProcessTimeAfter(now, amount, true)
	if !static || !safe || deadline > maxJSONSafeInteger || math.IsNaN(amount) || math.IsInf(amount, 0) ||
		amount < 0 || amount > float64(maxJSONSafeInteger) || math.Trunc(amount) != amount {
		return 0, e.invariant(operation.Path, "provider duration change requires safe static nonnegative integer milliseconds", operation.ProviderDefinitionRef)
	}
	return deadline, nil
}
