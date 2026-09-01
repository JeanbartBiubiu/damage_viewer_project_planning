package xyz.game.datamanage.model.skilleffect;

public record SkillEffectExecuteDetailRow(
    String gameId,
    String skillKey,
    String effectKey,
    String resultKey,
    String attributeKey
) {
}
