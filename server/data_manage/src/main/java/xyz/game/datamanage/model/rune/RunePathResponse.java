package xyz.game.datamanage.model.rune;

import java.time.OffsetDateTime;
import java.util.List;

public record RunePathResponse(
    String gameId, String pathKey, String name, String description, String kind,
    Integer sortOrder, List<RuneSlot> slots, OffsetDateTime createdAt, OffsetDateTime updatedAt
) {}
