package xyz.game.datamanage.model.skilltrigger;

public record SkillTriggerReferenceHit(
    String ruleKey,
    String field,
    String rejectedValue,
    String reason
) {
}
