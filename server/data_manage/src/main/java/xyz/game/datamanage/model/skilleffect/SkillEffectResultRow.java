package xyz.game.datamanage.model.skilleffect;

public record SkillEffectResultRow(
    String gameId,
    String skillKey,
    String effectKey,
    String resultKey,
    String name,
    SkillEffectResultType resultType,
    SkillEffectTarget target,
    String description,
    Integer sortOrder
) {
}
