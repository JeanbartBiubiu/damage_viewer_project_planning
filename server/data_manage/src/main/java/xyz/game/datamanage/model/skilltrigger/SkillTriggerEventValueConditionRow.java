package xyz.game.datamanage.model.skilltrigger;

public record SkillTriggerEventValueConditionRow(
    String gameId,
    String skillKey,
    String ruleKey,
    String groupKey,
    String conditionKey,
    SkillTriggerEventValueKey eventValueKey,
    SkillTriggerComparator comparator,
    String comparisonFormulaKey
) {
}
