package lifecycle

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

type ProviderPreparationInput struct {
	Definition, Reference, Source, Target string
	Ability                               plan.CompiledAbility
	Providers                             effectpkg.ProviderList
	TargetExists                          bool
	Now                                   int64
}

// ProviderPreparation 只在效果操作原位置准备严格读值，不提供操作、帧或队列能力。
type ProviderPreparation interface {
	// ProviderContext 在单次效果操作的原位置准备当前实际双方的求值输入，读值失败时返回原错。
	ProviderContext(ability plan.CompiledAbility, source, target string) (formula.GenericEvalContext, *model.EngineError)
}

// ProviderOperationPreparation 为效果专用操作提供同帧行动资格与事件身份交接。
type ProviderOperationPreparation interface {
	ProviderPreparation
	// ImmediatePeriodicApplication 核对本次立即周期与真实行动来源，失败发生在生命周期求值之前。
	ImmediatePeriodicApplication(operation plan.CompiledOperation) *model.EngineError
	// ExpireEventProvider 仅消费当前事件的真实实例归属，在同帧暂存卸载，不新建帧。
	ExpireEventProvider(operation plan.CompiledOperation) *model.EngineError
}

type ProviderOperationInput struct {
	Preparation ProviderPreparationInput
	Operation   plan.CompiledOperation
	UseRef      string
}

func (e *Executor) PrepareProviderMutation(input ProviderPreparationInput, reads ProviderPreparation) (PreparedLifecycle, *model.EngineError) {
	definitionRef, providerRef, sourceKey, targetKey, ability := input.Definition, input.Reference, input.Source, input.Target, input.Ability
	var provider plan.CompiledProvider
	if definitionRef != "" {
		defIdx, ok := e.FindDefinition(definitionRef)
		if !ok {
			return PreparedLifecycle{}, e.fail(model.GenericErrUnknownRef, "providerDefinitionRef", "unknown provider definition: "+definitionRef, definitionRef)
		}
		provider = e.compiled.Providers[defIdx]
	} else {
		if !input.TargetExists {
			return PreparedLifecycle{}, e.fail(model.GenericErrUnknownRef, "", "unknown combatant: "+targetKey, "")
		}
		providers := input.Providers
		inst, _, found := providers.Find(providerRef)
		if !found {
			return PreparedLifecycle{}, e.fail(model.GenericErrUnknownRef, "providerRef", "unknown providerRef: "+providerRef, providerRef)
		}
		if int(inst.DefinitionIndex) >= len(e.compiled.Providers) {
			return PreparedLifecycle{}, e.fail(model.GenericErrUnknownRef, "providerRef", "unknown provider definition for refresh", providerRef)
		}
		provider = e.compiled.Providers[inst.DefinitionIndex]
		if sourceKey == "" {
			sourceKey = inst.Source
		}
	}
	if provider.HasStateOnExpire {
		return PreparedLifecycle{}, e.fail(model.GenericErrRuntimeInvariantFailed, "providers", "state expiry source requires its real initial owner mount", provider.ProviderKey)
	}
	if provider.PermanentResourceMax {
		return PreparedLifecycle{}, e.fail(model.GenericErrRuntimeInvariantFailed, "providerDefinitionRef", "permanent HP instances are owned by cold initialization", provider.ProviderKey)
	}
	if provider.HasModifierSnapshots && providerRef != "" {
		return PreparedLifecycle{}, e.fail(model.GenericErrRuntimeInvariantFailed, "providerRef", "snapshot attribute refresh requires its complete actual application", providerRef)
	}
	if provider.AtomicDynamic && len(provider.StatusContributions) == 0 && (e.compiled.HasResourceMax || e.compiled.HasCooldownDuration || e.compiled.HasProviderDurationChange) {
		if (provider.HasResourceMax || provider.HasCooldownDuration) && sourceKey != targetKey {
			return PreparedLifecycle{}, e.fail(model.GenericErrRuntimeInvariantFailed, "target", "dynamic modifier requires actual self application", provider.ProviderKey)
		}
		expires, valid := actionpkg.ProcessTimeAfter(input.Now, float64(provider.StaticDurationMs), false)
		if !valid || expires > maxJSONSafeInteger {
			return PreparedLifecycle{}, e.fail(model.GenericErrRuntimeInvariantFailed, "lifecycle.durationMs", "dynamic modifier expiry overflows", provider.ProviderKey)
		}
		return PreparedLifecycle{ExpireAt: expires, HasExpireAt: true}, nil
	}
	evalCtx, err := reads.ProviderContext(ability, sourceKey, targetKey)
	if err != nil {
		return PreparedLifecycle{}, err
	}
	evalCtx.StrictReads = true
	return e.PrepareLifecycle(provider, evalCtx, input.Now)
}

func (e *Executor) StageProviderOperation(input ProviderOperationInput, preparation ProviderOperationPreparation) (Mutation, bool, *model.EngineError) {
	op := input.Operation
	mutation := Mutation{TargetKey: input.Preparation.Target, SourceKey: input.Preparation.Source}
	switch op.Operation {
	case "apply_provider":
		if op.ProviderDefinitionRef == "" {
			return mutation, false, e.fail(model.GenericErrMissingRequiredField, "", "apply_provider requires providerDefinitionRef", "")
		}
		if err := preparation.ImmediatePeriodicApplication(op); err != nil {
			return mutation, false, err
		}
		input.Preparation.Definition, input.Preparation.Reference = op.ProviderDefinitionRef, ""
		mutation.Kind, mutation.UseRef, mutation.DefinitionRef = "apply", input.UseRef, op.ProviderDefinitionRef
	case "refresh_provider":
		if op.ProviderRef == "" {
			return mutation, false, e.fail(model.GenericErrMissingRequiredField, "", "refresh_provider requires providerRef", "")
		}
		input.Preparation.Definition, input.Preparation.Reference = "", op.ProviderRef
		mutation.Kind, mutation.UseRef, mutation.ProviderRef = "refresh", input.UseRef, op.ProviderRef
	case "expire_provider":
		if op.ProviderRefFromEvent {
			return mutation, false, preparation.ExpireEventProvider(op)
		}
		if op.ProviderRef == "" {
			return mutation, false, e.fail(model.GenericErrMissingRequiredField, "", "expire_provider requires providerRef", "")
		}
		mutation.Kind, mutation.ProviderRef = "expire", op.ProviderRef
		return mutation, true, nil
	default:
		return mutation, false, e.invariant(op.Path, "unsupported provider operation", op.Operation)
	}
	prepared, err := e.PrepareProviderMutation(input.Preparation, preparation)
	if err != nil {
		return mutation, false, err
	}
	mutation.ExpireAt, mutation.HasExpireAt, mutation.Contributions = prepared.ExpireAt, prepared.HasExpireAt, prepared.Contributions
	return mutation, true, nil
}
