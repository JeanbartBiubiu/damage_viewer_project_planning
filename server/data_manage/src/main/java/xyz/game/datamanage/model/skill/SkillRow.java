package xyz.game.datamanage.model.skill;

import java.time.OffsetDateTime;

public record SkillRow(
    String gameId,
    String skillKey,
    String name,
    String description,
    Integer maxLevel,
    SkillStatus status,
    Integer sortOrder,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
}
