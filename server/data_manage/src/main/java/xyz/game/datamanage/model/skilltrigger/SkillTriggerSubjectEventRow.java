package xyz.game.datamanage.model.skilltrigger;

public record SkillTriggerSubjectEventRow(
    String gameId,
    String skillKey,
    String ruleKey,
    SkillTriggerSubject subject
) {
}
