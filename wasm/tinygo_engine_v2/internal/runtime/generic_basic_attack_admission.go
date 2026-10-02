package runtime

import "tinygo_engine_v2/internal/model"

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
			expected := 0
			if actor.Key == "source" {
				expected = 1
			}
			if len(actor.Providers) != expected || len(definition.ProviderMounts) != expected {
				return s.basicAttackErr("initial mounts must exactly match the compiled selected skill", "initialSnapshot.combatants.providers")
			}
			if expected == 1 {
				mount := definition.ProviderMounts[0]
				raw := actor.Providers[0]
				if raw.ProviderRef != mount.ProviderRef || raw.DefinitionRef != s.compiled.Providers[mount.DefinitionIndex].ProviderKey || raw.Source != actor.Key || raw.Owner != actor.Key || raw.Stacks != 1 || raw.ExpireAt != nil || len(raw.State)+len(raw.StatusContributions) != 0 {
					return s.basicAttackErr("initial selected skill must be persistent, single-layer and without runtime state", "initialSnapshot.combatants.providers")
				}
			}
		}
		if !found {
			return s.basicAttackErr("initial combatant is not compiled", "initialSnapshot.combatants")
		}
	}
	return nil
}
