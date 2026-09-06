package xyz.game.datamanage.model.skilltrigger;

import xyz.game.datamanage.model.value.SkillNumericValue;

public record SkillTriggerStatusConditionRow(
    String gameId,
    String skillKey,
    String ruleKey,
    String groupKey,
    String conditionKey,
    SkillTriggerSubject subject,
    String statusKey,
    SkillTriggerStatusCheckKind checkKind,
    String sourceEffectKey,
    String sourceResultKey,
    SkillTriggerComparator comparator,
    SkillNumericValue comparisonValue
) {
}
