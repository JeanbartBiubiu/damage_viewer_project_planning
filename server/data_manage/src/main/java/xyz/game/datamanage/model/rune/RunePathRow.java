package xyz.game.datamanage.model.rune;

import java.time.OffsetDateTime;

public record RunePathRow(
    String gameId, String pathKey, String name, String description, String kind,
    Integer sortOrder, String slotsJson, OffsetDateTime createdAt, OffsetDateTime updatedAt
) {}
