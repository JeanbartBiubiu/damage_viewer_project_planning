package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import java.util.Map;
import java.util.Set;
import xyz.game.datamanage.model.value.SkillNumericValue;

/** 最近正时间窗内，符合筛选条件的受伤累计。 */
public record SkillTriggerRecentDamageSumBindingDetail(
    SkillTriggerSubject subject,
    @Valid SkillNumericValue windowValue,
    SkillTriggerRecentDamageOutputKind outputKind,
    String sourceSkillKey,
    String damageTypeKey,
    SkillTriggerDamageDeliveryKind deliveryKind,
    SkillTriggerDamageOriginKind originKind,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerRuntimeInputBindingDetail {
    public SkillTriggerRecentDamageSumBindingDetail {
        sourceSkillKey = trim(sourceSkillKey);
        damageTypeKey = trim(damageTypeKey);
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerRecentDamageSumBindingDetail(
        SkillTriggerSubject subject, SkillNumericValue windowValue, SkillTriggerRecentDamageOutputKind outputKind,
        String sourceSkillKey, String damageTypeKey, SkillTriggerDamageDeliveryKind deliveryKind,
        SkillTriggerDamageOriginKind originKind
    ) {
        this(subject, windowValue, outputKind, sourceSkillKey, damageTypeKey, deliveryKind, originKind, Set.of());
    }

    @Override @JsonIgnore public Set<String> foreignFields() { return Set.of(); }

    @JsonCreator
    static SkillTriggerRecentDamageSumBindingDetail fromJson(
        @JsonProperty("subject") SkillTriggerSubject subject,
        @JsonProperty("windowValue") SkillNumericValue windowValue,
        @JsonProperty("outputKind") SkillTriggerRecentDamageOutputKind outputKind,
        @JsonProperty("sourceSkillKey") String sourceSkillKey,
        @JsonProperty("damageTypeKey") String damageTypeKey,
        @JsonProperty("deliveryKind") SkillTriggerDamageDeliveryKind deliveryKind,
        @JsonProperty("originKind") SkillTriggerDamageOriginKind originKind,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerRecentDamageSumBindingDetail(subject, windowValue, outputKind, sourceSkillKey,
            damageTypeKey, deliveryKind, originKind, SkillTriggerDetailFieldCapture.captureUnknown(unknown));
    }

    private static String trim(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
