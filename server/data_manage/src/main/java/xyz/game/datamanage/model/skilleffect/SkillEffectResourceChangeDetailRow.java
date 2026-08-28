package xyz.game.datamanage.model.skilleffect;

public record SkillEffectResourceChangeDetailRow(
    String gameId,
    String skillKey,
    String effectKey,
    String resultKey,
    String attributeKey,
    SkillEffectResourceChangeOperation operation
) {
}
