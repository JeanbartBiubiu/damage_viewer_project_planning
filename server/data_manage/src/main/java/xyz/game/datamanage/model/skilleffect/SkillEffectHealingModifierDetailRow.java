package xyz.game.datamanage.model.skilleffect;

public record SkillEffectHealingModifierDetailRow(
    String gameId,
    String skillKey,
    String effectKey,
    String resultKey,
    String modifierZoneKey,
    SkillEffectHealingModifierDirection direction,
    SkillEffectModifierOperation operation,
    SkillEffectHealingKind healingKind
) {
}
