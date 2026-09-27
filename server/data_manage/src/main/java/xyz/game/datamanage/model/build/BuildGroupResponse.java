package xyz.game.datamanage.model.build;

import java.time.OffsetDateTime;
import java.util.List;

public record BuildGroupResponse(
    String gameId,
    String systemKey,
    String groupKey,
    String name,
    String description,
    int sortOrder,
    List<BuildSlot> slots,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {}
