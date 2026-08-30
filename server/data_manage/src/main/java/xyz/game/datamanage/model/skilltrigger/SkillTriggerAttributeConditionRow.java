package xyz.game.datamanage.model.skilltrigger;

import xyz.game.datamanage.model.skillformula.AttributeValueKind;

public record SkillTriggerAttributeConditionRow(
    String gameId,
    String skillKey,
    String ruleKey,
    String groupKey,
    String conditionKey,
    SkillTriggerSubject subject,
    String attributeKey,
    AttributeValueKind attributeValueKind,
    SkillTriggerComparator comparator,
    String comparisonFormulaKey
) {
}
