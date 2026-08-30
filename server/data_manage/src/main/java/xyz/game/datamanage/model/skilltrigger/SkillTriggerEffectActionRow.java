package xyz.game.datamanage.model.skilltrigger;

public record SkillTriggerEffectActionRow(
    String gameId,
    String skillKey,
    String ruleKey,
    String actionKey,
    String effectKey
) {
}
