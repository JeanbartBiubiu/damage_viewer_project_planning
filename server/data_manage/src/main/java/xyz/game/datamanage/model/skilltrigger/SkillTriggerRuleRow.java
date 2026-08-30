package xyz.game.datamanage.model.skilltrigger;

import java.time.OffsetDateTime;

public record SkillTriggerRuleRow(
    String gameId,
    String skillKey,
    String ruleKey,
    String name,
    String description,
    Integer sortOrder,
    SkillTriggerEventType eventType,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
}
