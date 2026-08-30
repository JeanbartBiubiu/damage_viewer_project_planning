package xyz.game.datamanage.model.skilltrigger;

public record SkillTriggerResultEventRow(
    String gameId,
    String skillKey,
    String ruleKey,
    String effectKey,
    String resultKey
) {
}
