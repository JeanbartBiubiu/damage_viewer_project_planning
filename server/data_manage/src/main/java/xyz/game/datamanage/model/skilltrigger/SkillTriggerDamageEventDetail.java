package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillTriggerDamageEventDetail(
    String damageTypeKey,
    SkillTriggerDamageDeliveryKind deliveryKind,
    SkillTriggerDamageOriginKind originKind,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerEventDetail {

    public SkillTriggerDamageEventDetail {
        damageTypeKey = damageTypeKey == null ? null : damageTypeKey.trim();
        foreignFields = SkillTriggerDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerDamageEventDetail(
        String damageTypeKey,
        SkillTriggerDamageDeliveryKind deliveryKind,
        SkillTriggerDamageOriginKind originKind
    ) {
        this(damageTypeKey, deliveryKind, originKind, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillTriggerDamageEventDetail fromJson(
        @JsonProperty("damageTypeKey") String damageTypeKey,
        @JsonProperty("deliveryKind") SkillTriggerDamageDeliveryKind deliveryKind,
        @JsonProperty("originKind") SkillTriggerDamageOriginKind originKind,
        @JsonProperty("processKey") JsonNode processKey,
        @JsonProperty("moment") JsonNode moment,
        @JsonProperty("sourceSkillKey") JsonNode sourceSkillKey,
        @JsonProperty("useKind") JsonNode useKind,
        @JsonProperty("effectKey") JsonNode effectKey,
        @JsonProperty("resultKey") JsonNode resultKey,
        @JsonProperty("subject") JsonNode subject,
        @JsonProperty("statusKey") JsonNode statusKey,
        @JsonProperty("attributeKey") JsonNode attributeKey,
        @JsonProperty("thresholdValue") JsonNode thresholdValue,
        @JsonProperty("direction") JsonNode direction,
        @JsonProperty("stateKey") JsonNode stateKey,
        @JsonProperty("changeKind") JsonNode changeKind,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerDamageEventDetail(
            damageTypeKey,
            deliveryKind,
            originKind,
            SkillTriggerDetailFieldCapture.captureForeign(
                "processKey", processKey,
                "moment", moment,
                "sourceSkillKey", sourceSkillKey,
                "useKind", useKind,
                "effectKey", effectKey,
                "resultKey", resultKey,
                "subject", subject,
                "statusKey", statusKey,
                "attributeKey", attributeKey,
                "thresholdValue", thresholdValue,
                "direction", direction,
                "stateKey", stateKey,
                "changeKind", changeKind
            ),
            SkillTriggerDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
