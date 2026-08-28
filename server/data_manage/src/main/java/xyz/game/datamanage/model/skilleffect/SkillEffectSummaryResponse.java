package xyz.game.datamanage.model.skilleffect;

import java.time.OffsetDateTime;

public record SkillEffectSummaryResponse(
    String gameId,
    String skillKey,
    String effectKey,
    String name,
    String description,
    Integer sortOrder,
    Integer resultCount,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
}
