package lifecycle

import (
	"math"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

// ProviderDurationPreparation 只在原静态期限核验后准备动态投影及本拥有者当前实例。
type ProviderDurationPreparation interface {
	// PrepareDurationRead 在原位置准备效果投影，保留原失败与读取时点。
	PrepareDurationRead() *model.EngineError
	// DurationProviders 在投影成功后借用当前原暂存实例，不保存到下一操作。
	DurationProviders(owner string) effectpkg.ProviderList
}

func (e *Executor) PrepareDurationChange(operation plan.CompiledOperation, owner, source, provider string, now int64, reads ProviderDurationPreparation) (Mutation, bool, *model.EngineError) {
	deadline, err := e.durationExtensionDeadline(operation, owner, source, provider, now)
	if err != nil {
		return Mutation{}, false, err
	}
	if err := reads.PrepareDurationRead(); err != nil {
		return Mutation{}, false, err
	}
	return e.prepareDurationExtension(operation, owner, reads.DurationProviders(owner), deadline, now)
}

func (e *Executor) prepareDurationExtension(operation plan.CompiledOperation, owner string, instances effectpkg.ProviderList, deadline, now int64) (Mutation, bool, *model.EngineError) {
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

func (e *Executor) durationExtensionDeadline(operation plan.CompiledOperation, owner, source, provider string, now int64) (int64, *model.EngineError) {
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
	amount, static := e.formulas.Metadata.FoldStatic(operation.AmountProgram)
	deadline, safe := actionpkg.ProcessTimeAfter(now, amount, true)
	if !static || !safe || deadline > maxJSONSafeInteger || math.IsNaN(amount) || math.IsInf(amount, 0) ||
		amount < 0 || amount > float64(maxJSONSafeInteger) || math.Trunc(amount) != amount {
		return 0, e.invariant(operation.Path, "provider duration change requires safe static nonnegative integer milliseconds", operation.ProviderDefinitionRef)
	}
	return deadline, nil
}
