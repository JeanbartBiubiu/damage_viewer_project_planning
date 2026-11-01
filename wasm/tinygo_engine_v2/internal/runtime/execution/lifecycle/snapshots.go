package lifecycle

import (
	"math"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

func (e *Executor) FreezeModifierSnapshots(provider plan.CompiledProvider, source, target string, context formula.GenericEvalContext) (map[string]float64, *model.EngineError) {
	if source == "" || source == target || target == "" {
		return nil, e.invariant("providers", "modifier snapshots require actual distinct source and recipient", "")
	}
	context.StrictReads = true
	values := make(map[string]float64)
	for _, modifier := range provider.Modifiers {
		if modifier.ValueReadMode != "APPLICATION_SNAPSHOT" {
			continue
		}
		value, err := e.formulas.Eval(modifier.ValueProgram, context)
		if err != nil || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
			return nil, e.fail(model.GenericErrFormulaTypeError, "modifierSnapshots", "application snapshot must be a finite nonnegative actual attribute value", modifier.ModifierKey)
		}
		values[modifier.ModifierKey] = value
	}
	return values, nil
}
