package xyz.game.datamanage.model.skilltrigger;

import xyz.game.datamanage.model.value.SkillNumericValue;

public record SkillTriggerProcessLimitRow(
    String gameId,
    String skillKey,
    String ruleKey,
    String processKey,
    SkillNumericValue limitValue
) {
}
