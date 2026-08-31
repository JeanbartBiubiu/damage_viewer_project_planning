package xyz.game.datamanage.model.skilleffect;

public record SkillEffectAttributeChangeDetailRow(
    String gameId,
    String skillKey,
    String effectKey,
    String resultKey,
    String attributeKey,
    SkillEffectAttributeChangeOperation operation,
    String modifierZoneKey
) {
}
