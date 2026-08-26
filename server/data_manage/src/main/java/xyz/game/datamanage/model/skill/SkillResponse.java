package xyz.game.datamanage.model.skill;

import java.time.OffsetDateTime;
import java.util.List;

public record SkillResponse(
    String gameId,
    String skillKey,
    String name,
    String description,
    Integer maxLevel,
    SkillStatus status,
    Integer sortOrder,
    List<String> skillCategoryKeys,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
    public SkillResponse {
        skillCategoryKeys = skillCategoryKeys == null ? List.of() : List.copyOf(skillCategoryKeys);
    }
}
