package xyz.game.datamanage.model.skilleffect;

public record SkillEffectSkillTargetRow(
    String gameId,
    String skillKey,
    String effectKey,
    String resultKey,
    String affectedSkillKey
) {
}
