package xyz.game.datamanage.model.skilltrigger;

import xyz.game.datamanage.model.value.SkillNumericValue;

public record SkillTriggerInternalStateConditionRow(
    String gameId,
    String skillKey,
    String ruleKey,
    String groupKey,
    String conditionKey,
    String stateKey,
    SkillTriggerInternalStateValueKind valueKind,
    String optionKey,
    Boolean expectedBoolean,
    SkillTriggerComparator comparator,
    SkillNumericValue comparisonValue
) {
}
