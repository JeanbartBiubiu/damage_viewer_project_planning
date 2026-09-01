package xyz.game.datamanage.model.skilltrigger;

public record SkillTriggerLinkEventRow(
    String gameId,
    String skillKey,
    String ruleKey,
    String sourceSkillKey
) {
}
