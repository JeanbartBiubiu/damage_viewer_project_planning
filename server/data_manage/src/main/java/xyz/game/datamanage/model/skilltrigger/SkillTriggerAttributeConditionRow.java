package xyz.game.datamanage.model.skilltrigger;

import xyz.game.datamanage.model.skillformula.AttributeValueKind;
import xyz.game.datamanage.model.value.SkillNumericValue;

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
    SkillNumericValue comparisonValue
) {
}
