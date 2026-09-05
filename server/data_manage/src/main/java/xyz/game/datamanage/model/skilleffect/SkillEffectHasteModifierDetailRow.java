package xyz.game.datamanage.model.skilleffect;

public record SkillEffectHasteModifierDetailRow(
    String gameId,
    String skillKey,
    String effectKey,
    String resultKey,
    SkillEffectModifierOperation operation
) {
}
