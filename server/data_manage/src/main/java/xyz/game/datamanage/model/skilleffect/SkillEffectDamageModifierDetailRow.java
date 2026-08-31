package xyz.game.datamanage.model.skilleffect;

public record SkillEffectDamageModifierDetailRow(
    String gameId,
    String skillKey,
    String effectKey,
    String resultKey,
    String modifierZoneKey,
    SkillEffectDamageModifierDirection direction,
    SkillEffectModifierOperation operation,
    String damageTypeKey,
    SkillEffectDamageFilterDeliveryKind deliveryKind,
    SkillEffectDamageFilterOriginKind originKind,
    SkillEffectCriticalFilter criticalFilter
) {
}
