package xyz.game.datamanage.model.skilltrigger;

public record SkillTriggerDamageEventRow(
    String gameId,
    String skillKey,
    String ruleKey,
    String sourceSkillKey,
    String damageTypeKey,
    SkillTriggerDamageDeliveryKind deliveryKind,
    SkillTriggerDamageOriginKind originKind
) {
}
