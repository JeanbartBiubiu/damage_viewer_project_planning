package xyz.game.datamanage.model.skilltrigger;

import java.time.OffsetDateTime;

public record SkillTriggerRuleSummaryResponse(
    String ruleKey,
    String name,
    String description,
    SkillTriggerEventType eventType,
    Integer conditionGroupCount,
    Integer actionCount,
    Boolean perTargetCooldownEnabled,
    Boolean maxTriggersPerProcessEnabled,
    Boolean oncePerUseEnabled,
    Integer sortOrder,
    OffsetDateTime updatedAt
) {
}
