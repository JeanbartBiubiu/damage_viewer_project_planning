package xyz.game.datamanage.model.skilltrigger;

public record SkillTriggerProcessEventRow(
    String gameId,
    String skillKey,
    String ruleKey,
    String processKey,
    String momentType,
    String stepKey,
    String failureReason
) {
}
