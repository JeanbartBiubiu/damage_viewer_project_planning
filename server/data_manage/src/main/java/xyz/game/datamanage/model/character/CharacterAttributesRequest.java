package xyz.game.datamanage.model.character;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotNull;

public record CharacterAttributesRequest(
    @NotNull(message = "等级属性不能为空")
    JsonNode levelValues
) {
}
