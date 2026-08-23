package xyz.game.datamanage.model.equipment;

import com.fasterxml.jackson.databind.JsonNode;

public record EquipmentAttributesResponse(String equipmentKey, JsonNode attributeValues) {
}
