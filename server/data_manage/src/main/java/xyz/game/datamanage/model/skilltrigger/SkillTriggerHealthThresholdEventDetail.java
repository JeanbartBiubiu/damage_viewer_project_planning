package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillTriggerHealthThresholdEventDetail(
    SkillTriggerSubject subject,
    String attributeKey,
    String thresholdFormulaKey,
    SkillTriggerHealthDirection direction,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerEventDetail {

    public SkillTriggerHealthThresholdEventDetail {
        attributeKey = trimToNull(attributeKey);
        thresholdFormulaKey = trimToNull(thresholdFormulaKey);
        foreignFields = SkillTriggerDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerHealthThresholdEventDetail(
        SkillTriggerSubject subject,
        String attributeKey,
        String thresholdFormulaKey,
        SkillTriggerHealthDirection direction
    ) {
        this(subject, attributeKey, thresholdFormulaKey, direction, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillTriggerHealthThresholdEventDetail fromJson(
        @JsonProperty("subject") SkillTriggerSubject subject,
        @JsonProperty("attributeKey") String attributeKey,
        @JsonProperty("thresholdFormulaKey") String thresholdFormulaKey,
        @JsonProperty("direction") SkillTriggerHealthDirection direction,
        @JsonProperty("statusKey") JsonNode statusKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerHealthThresholdEventDetail(
            subject,
            attributeKey,
            thresholdFormulaKey,
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
