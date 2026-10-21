package runtime

import (
	"math"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/status"
)

// Evaluate on the already-owned final view. Runtime application snapshots remain
// immutable, and effectiveStatuses consumes exactly these observed strengths.
func (s *genericRunState) observeMomentStatusContributions(instances []status.ProviderInstance, snapshots []model.CombatantProviderSnapshot) *model.EngineError {
	for i, inst := range instances {
		if inst.Expired(s.nowMs) || int(inst.DefinitionIndex) >= len(s.compiled.Providers) {
			continue
		}
		provider := s.compiled.Providers[inst.DefinitionIndex]
		if !provider.HasMomentStatus {
			continue
		}
		if len(provider.StatusContributions) != 1 || len(inst.StatusContributions) != 1 || !provider.StatusContributions[0].MomentEvaluation || provider.StatusContributions[0].ResultRef != inst.StatusContributions[0].ResultRef {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "MOMENT_EVALUATION requires its exact compiled ordinary slow contribution", "providers["+inst.ProviderRef+"].statusContributions", inst.ProviderRef, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
		}
		value, err := s.evalMomentStatusStrength(inst, provider.StatusContributions[0])
		if err != nil {
			return err
		}
		*snapshots[i].StatusContributions[0].Strength = value
	}
	return nil
}

func (s *genericRunState) evalMomentStatusStrength(inst status.ProviderInstance, definition planbundle.CompiledStatusContribution) (float64, *model.EngineError) {
	bad := func(code model.GenericErrCode, message string) *model.EngineError {
		return engineErrorPtrAt(model.GenericPhaseRun, code, message, definition.Path+".strength", inst.ProviderRef, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	elapsed, actual := actualProviderElapsed(inst, s.nowMs)
	if !actual {
		return 0, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "MOMENT_EVALUATION requires the active instance's actual application time and finite deadline", "providers["+inst.ProviderRef+"].appliedAtMs", inst.ProviderRef, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	ctx := formula.GenericEvalContext{StrictReads: true, HasProviderContext: true, HasProviderElapsed: true, ProviderElapsedMs: elapsed}
	value, err := s.formulas.EvalContext(definition.StrengthProgram, &ctx)
	if err != nil {
		return 0, preserveFormulaIssue(err, bad(model.GenericErrFormulaTypeError, err.Error()))
	}
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || value > 1 {
		return 0, bad(model.GenericErrFormulaTypeError, "status contribution strength must be finite and within [0,1]")
	}
	return value, nil
}
