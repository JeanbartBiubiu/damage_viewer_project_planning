package xyz.game.datamanage.model.skilleffect;

public record SkillEffectDamageDetailRow(
    String gameId,
    String skillKey,
    String effectKey,
    String resultKey,
    String damageTypeKey,
    SkillEffectDamageDeliveryKind deliveryKind,
    SkillEffectDamageOriginKind originKind
) {
    public SkillEffectDamageDetailRow(
        String gameId,
        String skillKey,
        String effectKey,
        String resultKey,
        String damageTypeKey
    ) {
        this(
            gameId,
            skillKey,
            effectKey,
            resultKey,
            damageTypeKey,
            SkillEffectDamageDeliveryKind.SKILL,
            SkillEffectDamageOriginKind.DIRECT
        );
    }
}
