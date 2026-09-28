package xyz.game.datamanage.model.build;

import java.time.OffsetDateTime;
import java.util.List;

public record BuildOptionResponse(
    String gameId,
    String systemKey,
    String optionKey,
    String name,
    String description,
    int maxRank,
    List<Integer> rankCosts,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {}
