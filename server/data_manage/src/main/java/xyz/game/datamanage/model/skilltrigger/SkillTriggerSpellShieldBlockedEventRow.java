package xyz.game.datamanage.model.skilltrigger;

public record SkillTriggerSpellShieldBlockedEventRow(
    String gameId,
    String skillKey,
    String ruleKey,
    String shieldEffectKey
) {
}
