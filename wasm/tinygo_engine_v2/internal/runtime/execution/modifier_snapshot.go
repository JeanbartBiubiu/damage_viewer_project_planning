package execution

import (
	"math"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
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

func restoreModifierSnapshots(snapshot model.CombatantProviderSnapshot, provider plan.CompiledProvider, path, schema, rules, session string) (map[string]float64, *model.EngineError) {
	invalid := func(message string) (map[string]float64, *model.EngineError) {
		return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, message, path+".modifierSnapshots", snapshot.ProviderRef, schema, rules, session)
	}
	if !provider.HasModifierSnapshots {
		if snapshot.ModifierSnapshots != nil {
			return invalid("unmarked provider cannot restore modifier snapshots")
		}
		return nil, nil
	}
	if snapshot.Source == snapshot.Owner || snapshot.ModifierSnapshots == nil {
		return invalid("snapshot provider requires actual distinct participants and all frozen values")
	}
	expected := 0
	for _, modifier := range provider.Modifiers {
		if modifier.ValueReadMode != "APPLICATION_SNAPSHOT" {
			continue
		}
		expected++
		value, present := snapshot.ModifierSnapshots[modifier.ModifierKey]
		if !present || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
			return invalid("snapshot provider has a missing or invalid frozen value")
		}
		if modifier.ValuePolicy == "multiply" && value != modifier.StaticValue {
			return invalid("static snapshot multiplier differs from its compiled definition")
		}
	}
	if len(snapshot.ModifierSnapshots) != expected {
		return invalid("snapshot provider contains unknown frozen modifier keys")
	}
	return effectpkg.CloneFloatMap(snapshot.ModifierSnapshots), nil
}
