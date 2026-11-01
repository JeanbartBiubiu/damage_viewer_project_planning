package execution

import effectpkg "tinygo_engine_v2/internal/runtime/effect"
import reportpkg "tinygo_engine_v2/internal/runtime/report"

import actionpkg "tinygo_engine_v2/internal/runtime/action"

import (
	"math"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

type preparedProviderLifecycle struct {
	expireAt      int64
	hasExpireAt   bool
	contributions effectpkg.ContributionView
}

func (f *Frame) evalContextForProviderApply(ability planbundle.CompiledAbility, sourceKey, targetKey string) formula.GenericEvalContext {
	ctx := f.evalContext(ability)
	if sourceKey != "" && sourceKey != f.sourceKey {
		sc := f.stageFor(sourceKey)
		ctx.SourceAttrs = sc.attributesView()
		ctx.SourceResources = sc.resourceView()
	}
	if targetKey != "" && targetKey != f.targetKey {
		sc := f.stageFor(targetKey)
		ctx.TargetAttrs = sc.attributesView()
		ctx.TargetResources = sc.resourceView()
	}
	return ctx
}

func (f *Frame) prepareProviderMutation(definitionRef, providerRef, sourceKey, targetKey string, ability planbundle.CompiledAbility) (*preparedProviderLifecycle, *model.EngineError) {
	var provider planbundle.CompiledProvider
	if definitionRef != "" {
		defIdx, ok := f.run.findProviderDefinitionIndex(definitionRef)
		if !ok {
			return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "unknown provider definition: "+definitionRef, "providerDefinitionRef", definitionRef, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		provider = f.run.compiled.Providers[defIdx]
	} else {
		c, ok := f.run.combatants[targetKey]
		if !ok {
			return nil, engineErrorPtr(model.GenericPhaseRun, model.GenericErrUnknownRef, "unknown combatant: "+targetKey, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		providers := c.instances.Providers()
		if sc := f.staged.Get(targetKey); sc != nil {
			providers = sc.instances.Providers()
		}
		inst, _, found := providers.Find(providerRef)
		if !found {
			return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "unknown providerRef: "+providerRef, "providerRef", providerRef, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		if int(inst.DefinitionIndex) >= len(f.run.compiled.Providers) {
			return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "unknown provider definition for refresh", "providerRef", providerRef, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		provider = f.run.compiled.Providers[inst.DefinitionIndex]
		if sourceKey == "" {
			sourceKey = inst.Source
		}
	}
	if provider.HasStateOnExpire {
		return nil, f.providerLifecycleError(model.GenericErrRuntimeInvariantFailed, "providers", "state expiry source requires its real initial owner mount", provider.ProviderKey)
	}
	if provider.PermanentResourceMax {
		return nil, f.providerLifecycleError(model.GenericErrRuntimeInvariantFailed, "providerDefinitionRef", "permanent HP instances are owned by cold initialization", provider.ProviderKey)
	}
	if provider.HasModifierSnapshots && providerRef != "" {
		return nil, f.providerLifecycleError(model.GenericErrRuntimeInvariantFailed, "providerRef", "snapshot attribute refresh requires its complete actual target hit application", providerRef)
	}
	if provider.AtomicDynamic && (f.run.compiled.HasResourceMax || f.run.compiled.HasCooldownDuration || f.run.compiled.HasProviderDurationChange) {
		if (provider.HasResourceMax || provider.HasCooldownDuration) && sourceKey != targetKey {
			return nil, f.providerLifecycleError(model.GenericErrRuntimeInvariantFailed, "target", "dynamic modifier requires actual self application", provider.ProviderKey)
		}
		expires, valid := actionpkg.ProcessTimeAfter(f.run.loop.TimeMs(), float64(provider.StaticDurationMs), false)
		if !valid || expires > maxJSONSafeInteger {
			return nil, f.providerLifecycleError(model.GenericErrRuntimeInvariantFailed, "lifecycle.durationMs", "dynamic modifier expiry overflows", provider.ProviderKey)
		}
		return &preparedProviderLifecycle{expireAt: expires, hasExpireAt: true}, nil
	}
	evalCtx := f.evalContextForProviderApply(ability, sourceKey, targetKey)
	evalCtx.StrictReads = true
	return f.prepareProviderLifecycle(provider, evalCtx)
}

func (f *Frame) prepareProviderLifecycle(provider planbundle.CompiledProvider, evalCtx formula.GenericEvalContext) (*preparedProviderLifecycle, *model.EngineError) {
	out := &preparedProviderLifecycle{}
	if provider.NeedsElapsedTime && (f.run.loop.TimeMs() < 0 || f.run.loop.TimeMs() > maxJSONSafeInteger) {
		return nil, f.providerLifecycleError(model.GenericErrRuntimeInvariantFailed, "appliedAtMs", "elapsed-time provider requires a non-negative safe application timestamp", provider.ProviderKey)
	}
	if provider.Lifecycle != nil && provider.Lifecycle.HasDuration {
		expireAt, err := f.evalPreparedDuration(provider, evalCtx)
		if err != nil {
			return nil, err
		}
		out.expireAt = expireAt
		out.hasExpireAt = true
	} else if provider.Lifecycle != nil && provider.Lifecycle.AllowsSourceTargetReuse() {
		return nil, f.providerLifecycleError(model.GenericErrMissingRequiredField, provider.Lifecycle.DurationPath, "source_target duration is required", provider.ProviderKey)
	}
	if len(provider.StatusContributions) > 0 {
		if out.expireAt <= f.run.loop.TimeMs() {
			path := "provider[" + provider.ProviderKey + "].lifecycle.durationMs"
			if provider.Lifecycle != nil && provider.Lifecycle.DurationPath != "" {
				path = provider.Lifecycle.DurationPath
			}
			return nil, f.providerLifecycleError(model.GenericErrFormulaTypeError, path, "status contribution duration must be positive", provider.ProviderKey)
		}
		contribs, err := f.evalPreparedStatusContributions(provider, evalCtx)
		if err != nil {
			return nil, err
		}
		out.contributions = contribs
	}
	return out, nil
}

func (f *Frame) evalPreparedDuration(provider planbundle.CompiledProvider, evalCtx formula.GenericEvalContext) (int64, *model.EngineError) {
	lc := provider.Lifecycle
	strictDuration := lc.AllowsSourceTargetReuse() || provider.NeedsElapsedTime
	path := lc.DurationPath
	if path == "" {
		path = "provider[" + provider.ProviderKey + "].lifecycle.durationMs"
	}
	value, err := f.run.formulas.EvalContext(lc.DurationProgram, &evalCtx)
	if err != nil {
		return 0, f.preserveFormulaIssue(err, f.providerLifecycleError(model.GenericErrFormulaTypeError, path, err.Error(), provider.ProviderKey))
	}
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, f.providerLifecycleError(model.GenericErrFormulaTypeError, path, "non-finite duration", provider.ProviderKey)
	}
	if strictDuration && (value <= 0 || math.Trunc(value) != value || value >= 9223372036854775808.0) {
		return 0, f.providerLifecycleError(model.GenericErrFormulaTypeError, path, "source_target duration must be a positive integer within the timestamp range", provider.ProviderKey)
	}
	delta := int64(value)
	if strictDuration && delta <= 0 {
		return 0, f.providerLifecycleError(model.GenericErrFormulaTypeError, path, "source_target duration must be positive", provider.ProviderKey)
	}
	expireAt := f.run.loop.TimeMs() + delta
	if strictDuration && (expireAt <= f.run.loop.TimeMs() || expireAt <= 0) {
		return 0, f.providerLifecycleError(model.GenericErrFormulaTypeError, path, "source_target expiry overflows the timestamp range", provider.ProviderKey)
	}
	return expireAt, nil
}

func (f *Frame) evalPreparedStatusContributions(provider planbundle.CompiledProvider, evalCtx formula.GenericEvalContext) (effectpkg.ContributionView, *model.EngineError) {
	if provider.HasMomentStatus {
		// This actual apply/refresh frame starts the new instance lifetime. Do
		// not transport live attributes, ability parameters or event snapshots.
		evalCtx = formula.GenericEvalContext{StrictReads: true, HasProviderContext: true, HasProviderElapsed: true}
	}
	out := effectpkg.ContributionView{}
	for _, item := range provider.StatusContributions {
		path := item.Path + ".strength"
		if !item.HasStrength {
			return effectpkg.ContributionView{}, f.providerLifecycleError(model.GenericErrMissingRequiredField, path, "status contribution strength is required; explicit zero is allowed", item.ResultRef)
		}
		value, err := f.run.formulas.EvalContext(item.StrengthProgram, &evalCtx)
		if err != nil {
			return effectpkg.ContributionView{}, f.preserveFormulaIssue(err, f.providerLifecycleError(model.GenericErrFormulaTypeError, path, err.Error(), item.ResultRef))
		}
		if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || value > 1 {
			return effectpkg.ContributionView{}, f.providerLifecycleError(model.GenericErrFormulaTypeError, path, "status contribution strength must be finite and within [0,1]", item.ResultRef)
		}
		out = out.Append(effectpkg.StatusContribution{
			ResultRef:  item.ResultRef,
			StatusKey:  item.StatusKey,
			StatusKind: item.StatusKind,
			Strength:   value,
		})
	}
	return out, nil
}

func (f *Frame) providerLifecycleError(code model.GenericErrCode, path, message, ref string) *model.EngineError {
	return engineErrorPtrAt(model.GenericPhaseRun, code, message, path, ref, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
}

func (s *Engine) recordProviderLifecycleEvidence(kind model.EvidenceKind, inst effectpkg.Provider) {
	source := inst.Source
	if source == "" {
		source = inst.Owner
	}
	s.recordEvidenceLazy(kind, func() model.EvidenceItem {
		contributions := make([]map[string]interface{}, 0, inst.StatusContributions.Len())
		for index := 0; index < inst.StatusContributions.Len(); index++ {
			item := inst.StatusContributions.At(index)
			contributions = append(contributions, reportpkg.StatusContributionData(item.ResultRef, item.StatusKey, item.StatusKind, item.Strength))
		}
		return model.EvidenceItem{
			TimeMs: s.loop.TimeMs(),
			Kind:   kind,
			Ref:    inst.ProviderRef,
			Path:   "providers[" + inst.ProviderRef + "]",
			Data: map[string]interface{}{
				"providerRef":         inst.ProviderRef,
				"definitionRef":       inst.DefinitionRef,
				"source":              source,
				"owner":               inst.Owner,
				"expireAt":            inst.ExpireAt,
				"statusContributions": contributions,
			},
		}
	})
}
