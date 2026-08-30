package xyz.game.datamanage.model.skilltrigger;

public record SkillTriggerHealthThresholdEventRow(
    String gameId,
    String skillKey,
    String ruleKey,
    SkillTriggerSubject subject,
    String attributeKey,
    String thresholdFormulaKey,
    SkillTriggerHealthDirection direction
) {
}
