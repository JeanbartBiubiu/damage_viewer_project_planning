package xyz.game.datamanage.model.skilleffect;

public record SkillEffectSpellShieldPolicyRow(
    String gameId,
    String skillKey,
    String effectKey,
    String resultKey,
    SkillEffectSpellShieldBlockScope blockScope
) {
}
