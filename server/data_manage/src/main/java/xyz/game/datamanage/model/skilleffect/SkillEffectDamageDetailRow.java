package xyz.game.datamanage.model.skilleffect;

public record SkillEffectDamageDetailRow(
    String gameId,
    String skillKey,
    String effectKey,
    String resultKey,
    String damageTypeKey
) {
}
