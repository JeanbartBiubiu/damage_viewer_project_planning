package xyz.game.datamanage.model.rune;

import java.time.OffsetDateTime;

public record RuneResponse(
    String gameId, String runeKey, String name, String description, String category,
    OffsetDateTime createdAt, OffsetDateTime updatedAt
) {}
