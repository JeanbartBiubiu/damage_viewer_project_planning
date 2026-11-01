package execution

import (
	"math"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

func (f *Frame) freezeModifierSnapshots(provider plan.CompiledProvider, source, target string) (map[string]float64, *model.EngineError) {
	if source == "" || source == target || target == "" {
		return nil, f.run.basicAttackErr("modifier snapshots require actual distinct source and recipient", "providers")
	}
	context := f.evalContextForProviderApply(plan.CompiledAbility{}, source, target)
	context.StrictReads = true
	values := make(map[string]float64)
	for _, modifier := range provider.Modifiers {
		if modifier.ValueReadMode != "APPLICATION_SNAPSHOT" {
			continue
		}
		value, err := f.run.formulas.Eval(modifier.ValueProgram, context)
		if err != nil || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
			return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "application snapshot must be a finite nonnegative actual attribute value", "modifierSnapshots", modifier.ModifierKey, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		values[modifier.ModifierKey] = value
	}
	return values, nil
}
