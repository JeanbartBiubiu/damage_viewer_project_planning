package xyz.game.datamanage.model.skilltrigger;

public record SkillTriggerConditionRow(
    String gameId,
    String skillKey,
    String ruleKey,
    String groupKey,
    String conditionKey,
    SkillTriggerConditionType conditionType,
    Integer sortOrder
) {
}
