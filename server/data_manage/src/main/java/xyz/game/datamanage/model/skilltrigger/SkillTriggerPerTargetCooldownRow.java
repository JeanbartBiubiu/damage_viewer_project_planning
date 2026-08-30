package xyz.game.datamanage.model.skilltrigger;

public record SkillTriggerPerTargetCooldownRow(
    String gameId,
    String skillKey,
    String ruleKey,
    String durationFormulaKey,
    SkillTriggerTargetContext targetContext
) {
}
