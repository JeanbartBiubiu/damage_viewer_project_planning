package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillTriggerFailProcessActionDetail(
    String processKey,
    SkillTriggerProcessFailureReason failureReason,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerActionDetail {

    public SkillTriggerFailProcessActionDetail {
        processKey = trim(processKey);
        foreignFields = SkillTriggerDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerFailProcessActionDetail(String processKey, SkillTriggerProcessFailureReason failureReason) {
        this(processKey, failureReason, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillTriggerFailProcessActionDetail fromJson(
        @JsonProperty("processKey") String processKey,
        @JsonProperty("failureReason") SkillTriggerProcessFailureReason failureReason,
        @JsonProperty("effectKey") JsonNode effectKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerFailProcessActionDetail(
            processKey,
            failureReason,
            SkillTriggerDetailFieldCapture.captureForeign("effectKey", effectKey),
            SkillTriggerDetailFieldCapture.captureUnknown(unknown)
        );
    }

    private static String trim(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
