package xyz.game.datamanage.model.character;

import java.time.OffsetDateTime;

public record CharacterResponse(
    String gameId,
    String characterKey,
    String name,
    String description,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
}
