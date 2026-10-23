package xyz.game.datamanage.model.skilleffect;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;
import xyz.game.datamanage.model.value.SkillNumericValue;

public record SkillEffectDamageModifierDetail(
    String modifierZoneKey,
    SkillEffectDamageModifierDirection direction,
    SkillEffectModifierOperation operation,
    String damageTypeKey,
    SkillEffectDamageFilterDeliveryKind deliveryKind,
    SkillEffectDamageFilterOriginKind originKind,
    SkillEffectCriticalFilter criticalFilter,
    JsonNode condition,
    @JsonInclude(JsonInclude.Include.NON_NULL) SkillNumericValue maximumReductionRatioValue,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillEffectResultDetail {

    public SkillEffectDamageModifierDetail {
        modifierZoneKey = modifierZoneKey == null ? null : modifierZoneKey.trim();
        damageTypeKey = damageTypeKey == null ? null : damageTypeKey.trim();
        condition = condition == null || condition.isNull() ? null : condition;
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
        this(null, direction, operation, damageTypeKey, deliveryKind, originKind, criticalFilter, null, null, Set.of(), Set.of());
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
        this(modifierZoneKey, direction, operation, damageTypeKey, deliveryKind, originKind, criticalFilter, null, null, Set.of(), Set.of());
    }

    public SkillEffectDamageModifierDetail(
        String modifierZoneKey,
        SkillEffectDamageModifierDirection direction,
        SkillEffectModifierOperation operation,
        String damageTypeKey,
        SkillEffectDamageFilterDeliveryKind deliveryKind,
        SkillEffectDamageFilterOriginKind originKind,
        SkillEffectCriticalFilter criticalFilter,
        JsonNode condition
    ) {
        this(modifierZoneKey, direction, operation, damageTypeKey, deliveryKind, originKind, criticalFilter, condition, null, Set.of(), Set.of());
    }

    public SkillEffectDamageModifierDetail(String modifierZoneKey, SkillEffectDamageModifierDirection direction,
        SkillEffectModifierOperation operation, String damageTypeKey, SkillEffectDamageFilterDeliveryKind deliveryKind,
        SkillEffectDamageFilterOriginKind originKind, SkillEffectCriticalFilter criticalFilter, JsonNode condition,
        Set<String> foreignFields, Set<String> unknownFields) {
        this(modifierZoneKey, direction, operation, damageTypeKey, deliveryKind, originKind, criticalFilter,
            condition, null, foreignFields, unknownFields);
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
        @JsonProperty("condition") JsonNode condition,
        @JsonProperty("maximumReductionRatioValue") JsonNode maximumReductionRatioValue,
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
            condition,
            readMaximumReductionRatio(maximumReductionRatioValue),
            Set.of(),
            SkillEffectDetailFieldCapture.captureUnknown(unknown)
        );
    }

    private static SkillNumericValue readMaximumReductionRatio(JsonNode value) {
        if (value == null) return null;
        if (value.isNull()) throw new IllegalArgumentException("maximumReductionRatioValue 必须明确供值，不能为null");
        return SkillNumericValue.fromJson(value);
    }
}
