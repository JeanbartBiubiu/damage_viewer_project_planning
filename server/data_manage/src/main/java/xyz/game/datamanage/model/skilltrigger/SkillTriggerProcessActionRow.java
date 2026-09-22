package xyz.game.datamanage.model.skilltrigger;

public record SkillTriggerProcessActionRow(
    String gameId,
    String skillKey,
    String ruleKey,
    String actionKey,
    SkillTriggerActionType actionType,
    String processKey,
    String stepKey,
    SkillTriggerProcessFailureReason failureReason
) {
}
