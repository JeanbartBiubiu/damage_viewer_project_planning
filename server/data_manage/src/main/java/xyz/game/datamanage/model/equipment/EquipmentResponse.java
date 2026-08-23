package xyz.game.datamanage.model.equipment;

import java.time.OffsetDateTime;

public record EquipmentResponse(
    String gameId,
    String equipmentKey,
    String name,
    String description,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
}
