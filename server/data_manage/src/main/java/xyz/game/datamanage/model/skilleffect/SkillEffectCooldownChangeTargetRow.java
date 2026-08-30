package xyz.game.datamanage.model.skilleffect;

public record SkillEffectCooldownChangeTargetRow(
    String gameId,
    String skillKey,
    String effectKey,
    String resultKey,
    String affectedSkillKey
) {
}
