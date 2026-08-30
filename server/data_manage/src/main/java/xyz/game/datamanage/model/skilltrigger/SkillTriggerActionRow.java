package xyz.game.datamanage.model.skilltrigger;

public record SkillTriggerActionRow(
    String gameId,
    String skillKey,
    String ruleKey,
    String actionKey,
    String name,
    SkillTriggerActionType actionType,
    Integer sortOrder,
    SkillTriggerTargetContext targetContext
) {
}
