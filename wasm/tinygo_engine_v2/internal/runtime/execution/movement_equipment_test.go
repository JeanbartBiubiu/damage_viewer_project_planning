package execution

import (
	model "tinygo_engine_v2/internal/model"
)

func configuredMovementEquipment(duration int64) (model.CompileRequest, model.RunRequest) {
	input, request := continuousAttackInput(.5, 10000, 100, 0, 0, duration)
	definition := slowProvider("configured_slow", "movement", "ordinary_slow", .3, 1000)
	definition.StableID = "source_movement_equipment"
	input.SharedProviders = append(input.SharedProviders, definition)
	addCadenceEquipment(&input, &request, 0, "movement_equipment", model.ProviderDefinition{
		Listeners: []model.ListenerDefinition{{ListenerKey: "apply_movement", MaxTriggersPerEvent: 1,
			EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackHit, eventSourceOwner}},
			Operations:   []model.OperationDefinition{applyOp(definition.ProviderKey)},
		}},
	})
	return input, request
}
