package xyz.game.datamanage.model.skilltrigger;

public record SkillTriggerConditionGroupRow(
    String gameId,
    String skillKey,
    String ruleKey,
    String groupKey,
    String name,
    Integer sortOrder
) {
}
