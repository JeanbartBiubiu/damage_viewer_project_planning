package xyz.game.datamanage.model.skillprocess;

import java.time.OffsetDateTime;

public record SkillProcessRow(
    String gameId,
    String skillKey,
    String processKey,
    String name,
    SkillProcessActivationType activationType,
    String description,
    Integer sortOrder,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
}
