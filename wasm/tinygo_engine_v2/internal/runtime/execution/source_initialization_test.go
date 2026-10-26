package execution

import (
	model "tinygo_engine_v2/internal/model"
)

func sourceInitializationInput() (model.CompileRequest, model.RunRequest) {
	input, request := continuousAttackInput(1, 1000, 100, 0, 0, 1000)
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: model.EventTypeSourceInitialized, Domain: "event"})
	return input, request
}
