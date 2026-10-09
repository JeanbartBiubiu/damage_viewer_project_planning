package runtime

import (
	"math"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
)

func validateFixedEquipmentHealth(compiled planbundle.CompiledSession, actors map[string]combatantRuntime, sessionID string) *model.EngineError {
	for _, actor := range compiled.Combatants {
		hasHealthContribution := false
		for _, mount := range actor.ProviderMounts {
			provider := compiled.Providers[mount.DefinitionIndex]
			if provider.Kind != "item" || provider.Lifecycle != nil || provider.AbilityCount != 0 {
				continue
			}
			for _, modifier := range provider.Modifiers {
				selector := pipeline.ModifierTargetCombatantSelector(modifier.Target)
				if modifier.Kind == "attribute" && pipeline.AttributeKeyFromModifierTarget(modifier.Target) == "hp" && (selector == "" || selector == "self") {
					hasHealthContribution = true
				}
			}
		}
		if !hasHealthContribution {
			continue
		}
		hp := actors[actor.Key].attributes["hp"]
		if math.IsNaN(hp.Max) || math.IsInf(hp.Max, 0) || math.IsNaN(hp.Current) || math.IsInf(hp.Current, 0) || hp.Max <= 0 || hp.Current < 0 || hp.Current > hp.Max || math.Abs(hp.Max-hp.Resolved) > 1e-9*math.Max(1, math.Abs(hp.Max)) {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "equipped HP maximum must match native contributions and current HP must remain within it", "initialSnapshot.combatants."+actor.Key+".attributes.hp", "", compiled.SchemaHash, compiled.RulesHash, sessionID)
		}
	}
	return nil
}
