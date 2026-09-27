package xyz.game.datamanage.model.build;

import java.time.OffsetDateTime;

public record BuildSystemRow(
    String gameId,
    String systemKey,
    String name,
    String description,
    String configurationMode,
    Integer sortOrder,
    String selectionRulesJson,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {}
