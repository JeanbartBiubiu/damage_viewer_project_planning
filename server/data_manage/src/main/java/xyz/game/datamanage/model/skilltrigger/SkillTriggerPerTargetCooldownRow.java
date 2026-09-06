package xyz.game.datamanage.model.skilltrigger;

import xyz.game.datamanage.model.value.SkillNumericValue;

public record SkillTriggerPerTargetCooldownRow(
    String gameId,
    String skillKey,
    String ruleKey,
    SkillNumericValue durationValue,
    SkillTriggerTargetContext targetContext
) {
}
