package xyz.game.datamanage.model.skilltrigger;

import xyz.game.datamanage.model.value.SkillNumericValue;

public record SkillTriggerEventValueConditionRow(
    String gameId,
    String skillKey,
    String ruleKey,
    String groupKey,
    String conditionKey,
    SkillTriggerEventValueKey eventValueKey,
    SkillTriggerComparator comparator,
    SkillNumericValue comparisonValue
) {
}
