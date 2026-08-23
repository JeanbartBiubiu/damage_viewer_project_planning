package xyz.game.datamanage.model.equipment;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotNull;

public record EquipmentAttributesRequest(
    @NotNull(message = "装备属性不能为空")
    JsonNode attributeValues
) {
}
