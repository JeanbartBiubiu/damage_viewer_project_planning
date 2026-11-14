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
	if _, err := e.actualOwnDefinition(operation, owner, source, provider); err != nil {
		return 0, err
	}
	amount, static := e.formulas.Metadata.FoldStatic(operation.AmountProgram)
	deadline, safe := actionpkg.ProcessTimeAfter(now, amount, true)
	if !static || !safe || deadline > maxJSONSafeInteger || math.IsNaN(amount) || math.IsInf(amount, 0) ||
		amount < 0 || amount > float64(maxJSONSafeInteger) || math.Trunc(amount) != amount {
		return 0, e.invariant(operation.Path, "provider duration change requires safe static nonnegative integer milliseconds", operation.ProviderDefinitionRef)
	}
	return deadline, nil
}

// 实际帧身份不能由事件来源或技能名替代，父挂载也必须与编译的拥有者一致。
func (e *Executor) actualOwnDefinition(operation plan.CompiledOperation, owner, source, provider string) (uint16, *model.EngineError) {
	if !e.compiled.HasProviderDurationChange || operation.Target != model.SelectorSelf || owner != source || provider == "" {
		return 0, e.invariant(operation.Path, "own lifecycle change requires its actual source owner", operation.ProviderDefinitionRef)
	}
	owned := 0
	for _, actor := range e.compiled.Combatants {
		for _, mount := range actor.ProviderMounts {
			if actor.Key == owner && mount.ProviderRef == provider && int(mount.DefinitionIndex) == operation.OwnerProviderIndex {
				owned++
			}
		}
	}
	index, exists := e.FindDefinition(operation.ProviderDefinitionRef)
	if owned != 1 || !exists || !e.compiled.Providers[index].AtomicDynamic {
		return 0, e.invariant(operation.Path, "provider duration change references an unknown or foreign applying source", operation.ProviderDefinitionRef)
	}
	return index, nil
}

// PrepareOwnDefinitionExpiry 只移除核定来源自身的唯一有限实例；读取原位置的暂存投影。
func (e *Executor) PrepareOwnDefinitionExpiry(operation plan.CompiledOperation, owner, source, provider, target string, now int64, reads ProviderDurationPreparation) (Mutation, bool, *model.EngineError) {
	if operation.Operation != "expire_provider" || operation.ProviderDefinitionRef == "" || operation.ProviderRef != "" ||
		operation.ProviderRefFromEvent || operation.HasAmount || operation.HasCondition || operation.ValuePolicy != "" || target != owner {
		return Mutation{}, false, e.invariant(operation.Path, "definition expiry requires its actual own target and exclusive definition identity", operation.ProviderDefinitionRef)
	}
	index, err := e.actualOwnDefinition(operation, owner, source, provider)
	if err != nil {
		return Mutation{}, false, err
	}
	if err := reads.PrepareDurationRead(); err != nil {
		return Mutation{}, false, err
	}
	instances := reads.DurationProviders(owner)
	reference := ""
	for slot := 0; slot < instances.Len(); slot++ {
		instance := instances.At(slot)
		if instance.DefinitionIndex != index {
			continue
		}
		if instance.DefinitionRef != operation.ProviderDefinitionRef || instance.Owner != owner || instance.Source != source {
			return Mutation{}, false, e.invariant(operation.Path, "definition expiry found a foreign source instance", operation.ProviderDefinitionRef)
		}
		if instance.Expired(now) {
			continue
		}
		if reference != "" || instance.ExpireAt <= 0 {
			return Mutation{}, false, e.invariant(operation.Path, "definition expiry requires one active finite own instance", operation.ProviderDefinitionRef)
		}
		reference = instance.ProviderRef
	}
	if reference == "" {
		return Mutation{}, false, nil
	}
	return Mutation{Kind: "expire", DefinitionRef: operation.ProviderDefinitionRef, ProviderRef: reference,
		TargetKey: owner, SourceKey: source, Strict: true}, true, nil
}
