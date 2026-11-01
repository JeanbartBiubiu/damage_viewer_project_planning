package lifecycle

import (
	"math"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

func (e *Executor) ObserveMomentStatuses(instances effectpkg.ProviderList, snapshots []model.CombatantProviderSnapshot, now int64) *model.EngineError {
	for i, instanceValues := 0, instances; i < instanceValues.Len(); i++ {
		inst := instanceValues.At(i)
		if inst.Expired(now) || int(inst.DefinitionIndex) >= len(e.compiled.Providers) {
			continue
		}
		provider := e.compiled.Providers[inst.DefinitionIndex]
		if !provider.HasMomentStatus {
			continue
		}
		if len(provider.StatusContributions) != 1 || inst.StatusContributions.Len() != 1 || !provider.StatusContributions[0].MomentEvaluation || provider.StatusContributions[0].ResultRef != inst.StatusContributions.At(0).ResultRef {
			return e.invariant("providers["+inst.ProviderRef+"].statusContributions", "MOMENT_EVALUATION requires its exact compiled ordinary slow contribution", inst.ProviderRef)
		}
		value, err := e.momentStatusStrength(inst, provider.StatusContributions[0], now)
		if err != nil {
			return err
		}
		*snapshots[i].StatusContributions[0].Strength = value
	}
	return nil
}

func (e *Executor) momentStatusStrength(inst effectpkg.Provider, definition plan.CompiledStatusContribution, now int64) (float64, *model.EngineError) {
	bad := func(code model.GenericErrCode, message string) *model.EngineError {
		return e.fail(code, definition.Path+".strength", message, inst.ProviderRef)
	}
	elapsed, actual := ActualElapsed(inst, now)
	if !actual {
		return 0, e.invariant("providers["+inst.ProviderRef+"].appliedAtMs", "MOMENT_EVALUATION requires the active instance's actual application time and finite deadline", inst.ProviderRef)
	}
	ctx := formula.GenericEvalContext{StrictReads: true, HasProviderContext: true, HasProviderElapsed: true, ProviderElapsedMs: elapsed}
	value, err := e.formulas.EvalContext(definition.StrengthProgram, &ctx)
	if err != nil {
		return 0, preserveFormulaIssue(err, bad(model.GenericErrFormulaTypeError, err.Error()))
	}
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || value > 1 {
		return 0, bad(model.GenericErrFormulaTypeError, "status contribution strength must be finite and within [0,1]")
	}
	return value, nil
}
