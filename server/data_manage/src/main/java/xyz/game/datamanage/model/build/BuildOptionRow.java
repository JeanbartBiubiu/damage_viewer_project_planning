package xyz.game.datamanage.model.build;

import java.time.OffsetDateTime;

public record BuildOptionRow(
    String gameId,
    String systemKey,
    String optionKey,
    String name,
    String description,
    Integer maxRank,
    String rankCostsJson,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {}
