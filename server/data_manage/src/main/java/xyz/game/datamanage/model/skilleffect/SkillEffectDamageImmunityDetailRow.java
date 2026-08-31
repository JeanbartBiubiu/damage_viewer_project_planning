package xyz.game.datamanage.model.skilleffect;

public record SkillEffectDamageImmunityDetailRow(
    String gameId,
    String skillKey,
    String effectKey,
    String resultKey,
    String damageTypeKey,
    SkillEffectDamageFilterDeliveryKind deliveryKind,
    SkillEffectDamageFilterOriginKind originKind
) {
}
