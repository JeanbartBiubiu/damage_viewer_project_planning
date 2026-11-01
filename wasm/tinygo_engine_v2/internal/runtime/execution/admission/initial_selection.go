package admission

import (
	"math"
	"tinygo_engine_v2/internal/model"
)

// ValidateInitialSelection 分别校验原始选择和实际解析的生命上限，保留原有错误顺序。
func ValidateInitialSelection(input Input, initial []model.CombatantSnapshot, checkMaximum bool) *model.EngineError {
	if len(initial) != 2 || len(input.Compiled.Combatants) != 2 {
		return fail(input, "continuous attack requires exactly two compiled initial combatants", "initialSnapshot.combatants")
	}
	seen := map[string]bool{}
	for _, actor := range initial {
		if seen[actor.Key] || (actor.Key != "source" && actor.Key != "target") {
			return fail(input, "unexpected or duplicate initial combatant", "initialSnapshot.combatants")
		}
		seen[actor.Key] = true
		found := false
		for _, definition := range input.Compiled.Combatants {
			if actor.Key != definition.Key {
				continue
			}
			found = true
			if len(actor.Attributes) != len(definition.Attributes) || len(actor.Resources) != len(definition.Resources) {
				return fail(input, "initial numeric slots must come from this compiled input", "initialSnapshot.combatants")
			}
			for key, value := range definition.Attributes {
				if actual, ok := actor.Attributes[key]; !ok || actual != value {
					return fail(input, "initial attribute differs from the compiled input", "initialSnapshot.combatants.attributes."+key)
				}
			}
			for key, value := range definition.Resources {
				if actual, ok := actor.Resources[key]; !ok || actual != value {
					return fail(input, "initial resource differs from the compiled input", "initialSnapshot.combatants.resources."+key)
				}
			}
			if len(actor.Providers) != len(definition.ProviderMounts) {
				return fail(input, "initial mounts must exactly match the compiled selection", "initialSnapshot.combatants.providers")
			}
			seenMounts := map[string]bool{}
			for _, raw := range actor.Providers {
				matched := false
				for _, mount := range definition.ProviderMounts {
					if raw.ProviderRef == mount.ProviderRef && raw.DefinitionRef == input.Compiled.Providers[mount.DefinitionIndex].ProviderKey {
						matched = true
						break
					}
				}
				if !matched || seenMounts[raw.ProviderRef] || raw.Source != actor.Key || raw.Owner != actor.Key || raw.Stacks != 1 || raw.ExpireAt != nil || len(raw.State)+len(raw.StatusContributions) != 0 {
					return fail(input, "initial providers must match the fresh single-layer selected mounts", "initialSnapshot.combatants.providers")
				}
				seenMounts[raw.ProviderRef] = true
			}
			resolved, _ := actorView(input, actor.Key)
			hp := resolved.Attributes.At("hp")
			if checkMaximum && (math.IsNaN(hp.Max) || math.IsInf(hp.Max, 0) || hp.Max <= 0 || hp.Current < 0 || hp.Current > hp.Max || math.Abs(hp.Max-hp.Resolved) > 1e-9*math.Max(1, math.Abs(hp.Max))) {
				return fail(input, "initial HP maximum must equal the native equipped maximum and current HP must stay within it", "initialSnapshot.combatants.attributes.hp")
			}
		}
		if !found {
			return fail(input, "initial combatant is not compiled", "initialSnapshot.combatants")
		}
	}
	return nil
}
