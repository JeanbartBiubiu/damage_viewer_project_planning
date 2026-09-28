package xyz.game.datamanage.model.build;

import java.time.OffsetDateTime;

public record BuildGroupRow(
    String gameId,
    String systemKey,
    String groupKey,
    String name,
    String description,
    Integer sortOrder,
    String slotsJson,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {}
