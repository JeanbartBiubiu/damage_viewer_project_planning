package xyz.game.datamanage.model.skilleffect;

public record SkillEffectCooldownChangeDetailRow(
    String gameId,
    String skillKey,
    String effectKey,
    String resultKey,
    SkillEffectCooldownChangeOperation operation
) {
}
