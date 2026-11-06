package lifecycle

import (
	"math"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	"tinygo_engine_v2/internal/runtime/execution/evaluation"
)

func (e *Executor) PrepareLifecycle(provider plan.CompiledProvider, evalCtx formula.GenericEvalContext, now int64) (PreparedLifecycle, *model.EngineError) {
	out := PreparedLifecycle{}
	if provider.NeedsElapsedTime && (now < 0 || now > maxJSONSafeInteger) {
		return PreparedLifecycle{}, e.fail(model.GenericErrRuntimeInvariantFailed, "appliedAtMs", "elapsed-time provider requires a non-negative safe application timestamp", provider.ProviderKey)
	}
	if provider.Lifecycle != nil && provider.Lifecycle.HasDuration {
		expireAt, err := e.preparedDuration(provider, evalCtx, now)
		if err != nil {
			return PreparedLifecycle{}, err
		}
		out.ExpireAt = expireAt
		out.HasExpireAt = true
	} else if provider.Lifecycle != nil && provider.Lifecycle.AllowsSourceTargetReuse() {
		return PreparedLifecycle{}, e.fail(model.GenericErrMissingRequiredField, provider.Lifecycle.DurationPath, "source_target duration is required", provider.ProviderKey)
	}
	if len(provider.StatusContributions) > 0 {
		if out.ExpireAt <= now {
			path := "provider[" + provider.ProviderKey + "].lifecycle.durationMs"
			if provider.Lifecycle != nil && provider.Lifecycle.DurationPath != "" {
				path = provider.Lifecycle.DurationPath
			}
			return PreparedLifecycle{}, e.fail(model.GenericErrFormulaTypeError, path, "status contribution duration must be positive", provider.ProviderKey)
		}
		contribs, err := e.preparedStatus(provider, evalCtx)
		if err != nil {
			return PreparedLifecycle{}, err
		}
		out.Contributions = contribs
	}
	return out, nil
}

func (e *Executor) preparedDuration(provider plan.CompiledProvider, evalCtx formula.GenericEvalContext, now int64) (int64, *model.EngineError) {
	lc := provider.Lifecycle
	strictDuration := lc.AllowsSourceTargetReuse() || provider.NeedsElapsedTime
	path := lc.DurationPath
	if path == "" {
		path = "provider[" + provider.ProviderKey + "].lifecycle.durationMs"
	}
	value, err := e.formulas.EvalContext(lc.DurationProgram, &evalCtx)
	if err != nil {
		return 0, evaluation.PreserveFormulaIssue(err, e.fail(model.GenericErrFormulaTypeError, path, err.Error(), provider.ProviderKey), "")
	}
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, e.fail(model.GenericErrFormulaTypeError, path, "non-finite duration", provider.ProviderKey)
	}
	if strictDuration && (value <= 0 || math.Trunc(value) != value || value >= 9223372036854775808.0) {
		return 0, e.fail(model.GenericErrFormulaTypeError, path, "source_target duration must be a positive integer within the timestamp range", provider.ProviderKey)
	}
	delta := int64(value)
	if strictDuration && delta <= 0 {
		return 0, e.fail(model.GenericErrFormulaTypeError, path, "source_target duration must be positive", provider.ProviderKey)
	}
	expireAt := now + delta
	if strictDuration && (expireAt <= now || expireAt <= 0) {
		return 0, e.fail(model.GenericErrFormulaTypeError, path, "source_target expiry overflows the timestamp range", provider.ProviderKey)
	}
	return expireAt, nil
}

func (e *Executor) preparedStatus(provider plan.CompiledProvider, evalCtx formula.GenericEvalContext) (effectpkg.ContributionView, *model.EngineError) {
	if provider.HasMomentStatus {
		// This actual apply/refresh frame starts the new instance lifetime. Do
		// not transport live attributes, ability parameters or event snapshots.
		evalCtx = formula.GenericEvalContext{StrictReads: true, HasProviderContext: true, HasProviderElapsed: true}
	}
	out := effectpkg.ContributionView{}
	for _, item := range provider.StatusContributions {
		path := item.Path + ".strength"
		if !item.HasStrength {
			return effectpkg.ContributionView{}, e.fail(model.GenericErrMissingRequiredField, path, "status contribution strength is required; explicit zero is allowed", item.ResultRef)
		}
		value, err := e.formulas.EvalContext(item.StrengthProgram, &evalCtx)
		if err != nil {
			return effectpkg.ContributionView{}, evaluation.PreserveFormulaIssue(err, e.fail(model.GenericErrFormulaTypeError, path, err.Error(), item.ResultRef), "")
		}
		if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || value > 1 {
			return effectpkg.ContributionView{}, e.fail(model.GenericErrFormulaTypeError, path, "status contribution strength must be finite and within [0,1]", item.ResultRef)
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
