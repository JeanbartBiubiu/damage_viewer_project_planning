package xyz.game.datamanage.model.character;

import com.fasterxml.jackson.databind.JsonNode;

public record CharacterAttributesResponse(
    String characterKey,
    int minLevel,
    int maxLevel,
    JsonNode levelValues
) {
}
