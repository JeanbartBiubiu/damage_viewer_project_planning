package runtime

import (
	"math"
	"tinygo_engine_v2/internal/model"
)

func (s *genericRunState) validateBasicAttackInitialSnapshot() *model.EngineError {
	if len(s.req.InitialSnapshot.Combatants) != 2 || len(s.compiled.Combatants) != 2 {
		return s.basicAttackErr("continuous attack requires exactly two compiled initial combatants", "initialSnapshot.combatants")
	}
	seen := map[string]bool{}
	for _, actor := range s.req.InitialSnapshot.Combatants {
		if seen[actor.Key] || (actor.Key != "source" && actor.Key != "target") {
			return s.basicAttackErr("unexpected or duplicate initial combatant", "initialSnapshot.combatants")
		}
		seen[actor.Key] = true
		found := false
		for _, definition := range s.compiled.Combatants {
			if actor.Key != definition.Key {
				continue
			}
			found = true
			if len(actor.Attributes) != len(definition.Attributes) || len(actor.Resources) != len(definition.Resources) {
				return s.basicAttackErr("initial numeric slots must come from this compiled input", "initialSnapshot.combatants")
			}
			for key, value := range definition.Attributes {
				if actual, ok := actor.Attributes[key]; !ok || actual != value {
					return s.basicAttackErr("initial attribute differs from the compiled input", "initialSnapshot.combatants.attributes."+key)
				}
			}
			for key, value := range definition.Resources {
				if actual, ok := actor.Resources[key]; !ok || actual != value {
					return s.basicAttackErr("initial resource differs from the compiled input", "initialSnapshot.combatants.resources."+key)
				}
			}
			if len(actor.Providers) != len(definition.ProviderMounts) {
				return s.basicAttackErr("initial mounts must exactly match the compiled selection", "initialSnapshot.combatants.providers")
			}
			seenMounts := map[string]bool{}
			for _, raw := range actor.Providers {
				matched := false
				for _, mount := range definition.ProviderMounts {
					if raw.ProviderRef == mount.ProviderRef && raw.DefinitionRef == s.compiled.Providers[mount.DefinitionIndex].ProviderKey {
						matched = true
						break
					}
				}
				if !matched || seenMounts[raw.ProviderRef] || raw.Source != actor.Key || raw.Owner != actor.Key || raw.Stacks != 1 || raw.ExpireAt != nil || len(raw.State)+len(raw.StatusContributions) != 0 {
					return s.basicAttackErr("initial providers must match the fresh single-layer selected mounts", "initialSnapshot.combatants.providers")
				}
				seenMounts[raw.ProviderRef] = true
			}
			hp := s.combatants[actor.Key].attributes["hp"]
			if math.IsNaN(hp.Max) || math.IsInf(hp.Max, 0) || hp.Max <= 0 || hp.Current < 0 || hp.Current > hp.Max || math.Abs(hp.Max-hp.Resolved) > 1e-9*math.Max(1, math.Abs(hp.Max)) {
				return s.basicAttackErr("initial HP maximum must equal the native equipped maximum and current HP must stay within it", "initialSnapshot.combatants.attributes.hp")
			}
		}
		if !found {
			return s.basicAttackErr("initial combatant is not compiled", "initialSnapshot.combatants")
		}
	}
	return nil
}
