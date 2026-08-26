package xyz.game.datamanage.model.damagetype;

import java.time.OffsetDateTime;

public record DamageTypeResponse(
    String gameId,
    String damageTypeKey,
    String name,
    String description,
    DamageTypeStatus status,
    Integer sortOrder,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
}
