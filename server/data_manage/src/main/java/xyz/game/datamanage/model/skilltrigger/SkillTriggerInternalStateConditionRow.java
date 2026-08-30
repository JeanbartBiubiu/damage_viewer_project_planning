package xyz.game.datamanage.model.skilltrigger;

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
    String comparisonFormulaKey
) {
}
