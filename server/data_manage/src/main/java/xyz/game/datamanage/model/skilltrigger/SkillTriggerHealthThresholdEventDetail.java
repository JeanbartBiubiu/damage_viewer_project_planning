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

public record SkillTriggerHealthThresholdEventDetail(
    SkillTriggerSubject subject,
    String attributeKey,
    @Valid
    SkillNumericValue thresholdValue,
    SkillTriggerHealthDirection direction,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerEventDetail {

    public SkillTriggerHealthThresholdEventDetail {
        attributeKey = trimToNull(attributeKey);
        foreignFields = SkillTriggerDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerHealthThresholdEventDetail(
        SkillTriggerSubject subject,
        String attributeKey,
        SkillNumericValue thresholdValue,
        SkillTriggerHealthDirection direction
    ) {
        this(subject, attributeKey, thresholdValue, direction, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillTriggerHealthThresholdEventDetail fromJson(
        @JsonProperty("subject") SkillTriggerSubject subject,
        @JsonProperty("attributeKey") String attributeKey,
        @JsonProperty("thresholdValue") SkillNumericValue thresholdValue,
        @JsonProperty("direction") SkillTriggerHealthDirection direction,
        @JsonProperty("statusKey") JsonNode statusKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerHealthThresholdEventDetail(
            subject,
            attributeKey,
            thresholdValue,
            direction,
            SkillTriggerDetailFieldCapture.captureForeign("statusKey", statusKey),
            SkillTriggerDetailFieldCapture.captureUnknown(unknown)
        );
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
