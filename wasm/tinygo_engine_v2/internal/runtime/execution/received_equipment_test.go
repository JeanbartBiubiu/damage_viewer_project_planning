package execution

import (
	model "tinygo_engine_v2/internal/model"
)

const (
	receivedDeliveryBasic   = "damage_trait/delivery_basic_attack"
	receivedOriginDirect    = "damage_trait/origin_direct"
	receivedOriginReflected = "damage_trait/origin_reflected"
)

func receivedEquipmentTypes(input *model.CompileRequest) {
	for _, entry := range []model.TypeCatalogEntry{
		{Key: model.EventTypeBasicAttackReceived, Domain: "event"}, {Key: model.EventTypeDamageTaken, Domain: "event"},
		{Key: model.EventTypeHitLinkApplied, Domain: "event"}, {Key: eventTargetOwner, Domain: "event"},
		{Key: "state_scope/provider", Domain: "state_scope"},
		{Key: receivedDeliveryBasic, Domain: "damage_trait"}, {Key: receivedOriginDirect, Domain: "damage_trait"},
		{Key: receivedOriginReflected, Domain: "damage_trait"},
		{Key: "combatant/champion", Domain: "combatant"}, {Key: "ability/passive", Domain: "ability"},
	} {
		declared := false
		for _, current := range input.TypeCatalog.Types {
			declared = declared || current.Key == entry.Key
		}
		if !declared {
			input.TypeCatalog.Types = append(input.TypeCatalog.Types, entry)
		}
	}
}
