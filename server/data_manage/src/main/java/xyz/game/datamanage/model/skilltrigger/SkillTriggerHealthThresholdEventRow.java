package xyz.game.datamanage.model.skilltrigger;

import xyz.game.datamanage.model.value.SkillNumericValue;

public record SkillTriggerHealthThresholdEventRow(
    String gameId,
    String skillKey,
    String ruleKey,
    SkillTriggerSubject subject,
    String attributeKey,
    SkillNumericValue thresholdValue,
    SkillTriggerHealthDirection direction
) {
}
