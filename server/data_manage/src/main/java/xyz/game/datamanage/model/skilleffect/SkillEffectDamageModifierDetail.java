package xyz.game.datamanage.model.skilleffect;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillEffectDamageModifierDetail(
    String modifierZoneKey,
    SkillEffectDamageModifierDirection direction,
    SkillEffectModifierOperation operation,
    String damageTypeKey,
    SkillEffectDamageFilterDeliveryKind deliveryKind,
    SkillEffectDamageFilterOriginKind originKind,
    SkillEffectCriticalFilter criticalFilter,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillEffectResultDetail {

    public SkillEffectDamageModifierDetail {
        modifierZoneKey = modifierZoneKey == null ? null : modifierZoneKey.trim();
        damageTypeKey = damageTypeKey == null ? null : damageTypeKey.trim();
        foreignFields = SkillEffectDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillEffectDetailFieldCapture.normalize(unknownFields);
    }

    public SkillEffectDamageModifierDetail(
        SkillEffectDamageModifierDirection direction,
        SkillEffectModifierOperation operation,
        String damageTypeKey,
        SkillEffectDamageFilterDeliveryKind deliveryKind,
        SkillEffectDamageFilterOriginKind originKind,
        SkillEffectCriticalFilter criticalFilter
    ) {
        this(null, direction, operation, damageTypeKey, deliveryKind, originKind, criticalFilter, Set.of(), Set.of());
    }

    public SkillEffectDamageModifierDetail(
        String modifierZoneKey,
        SkillEffectDamageModifierDirection direction,
        SkillEffectModifierOperation operation,
        String damageTypeKey,
        SkillEffectDamageFilterDeliveryKind deliveryKind,
        SkillEffectDamageFilterOriginKind originKind,
        SkillEffectCriticalFilter criticalFilter
    ) {
        this(modifierZoneKey, direction, operation, damageTypeKey, deliveryKind, originKind, criticalFilter, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillEffectDamageModifierDetail fromJson(
        @JsonProperty("modifierZoneKey") String modifierZoneKey,
        @JsonProperty("direction") SkillEffectDamageModifierDirection direction,
        @JsonProperty("operation") SkillEffectModifierOperation operation,
        @JsonProperty("damageTypeKey") String damageTypeKey,
        @JsonProperty("deliveryKind") SkillEffectDamageFilterDeliveryKind deliveryKind,
        @JsonProperty("originKind") SkillEffectDamageFilterOriginKind originKind,
        @JsonProperty("criticalFilter") SkillEffectCriticalFilter criticalFilter,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillEffectDamageModifierDetail(
            modifierZoneKey,
            direction,
            operation,
            damageTypeKey,
            deliveryKind,
            originKind,
            criticalFilter,
            Set.of(),
            SkillEffectDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
