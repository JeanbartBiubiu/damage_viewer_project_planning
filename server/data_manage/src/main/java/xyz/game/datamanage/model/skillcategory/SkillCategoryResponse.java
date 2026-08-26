package xyz.game.datamanage.model.skillcategory;

import java.time.OffsetDateTime;

public record SkillCategoryResponse(
    String gameId,
    String skillCategoryKey,
    String name,
    String description,
    SkillCategoryStatus status,
    Integer sortOrder,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
}
