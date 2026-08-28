package xyz.game.datamanage.model.skilleffect;

import java.time.OffsetDateTime;

public record SkillEffectRow(
    String gameId,
    String skillKey,
    String effectKey,
    String name,
    String description,
    Integer sortOrder,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
}
