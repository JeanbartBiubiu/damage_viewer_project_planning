package xyz.game.datamanage.model.skilleffect;

public record SkillEffectSkillCategoryTargetRow(
    String gameId,
    String skillKey,
    String effectKey,
    String resultKey,
    String skillCategoryKey
) {
}
