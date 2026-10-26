package execution

import (
	model "tinygo_engine_v2/internal/model"
)

func addPermanentSkillSource(input *model.CompileRequest, request *model.RunRequest, actorIndex int, key, kind string, modifier model.ModifierDefinition) {
	owner := input.Combatants[actorIndex].Key
	effectKey := key + "_effect"
	input.SharedProviders = append(input.SharedProviders,
		model.ProviderDefinition{ProviderKey: effectKey, StableID: effectKey, Kind: "status", Modifiers: []model.ModifierDefinition{modifier}},
		model.ProviderDefinition{ProviderKey: key, StableID: key, Kind: kind, Listeners: []model.ListenerDefinition{
			{ListenerKey: "initialize", EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSourceInitialized, "event/source_owner"}},
				MaxTriggersPerEvent: 1, Operations: []model.OperationDefinition{
					{Operation: "apply_provider", Target: "self", ProviderRef: effectKey, ProviderDefinitionRef: effectKey},
				}},
		}})
	input.Combatants[actorIndex].Providers = append(input.Combatants[actorIndex].Providers,
		model.CombatantProviderMount{ProviderRef: key, DefinitionRef: key})
	request.InitialSnapshot.Combatants[actorIndex].Providers = append(request.InitialSnapshot.Combatants[actorIndex].Providers,
		model.CombatantProviderSnapshot{ProviderRef: key, DefinitionRef: key, Source: owner, Owner: owner, Stacks: 1})
}
