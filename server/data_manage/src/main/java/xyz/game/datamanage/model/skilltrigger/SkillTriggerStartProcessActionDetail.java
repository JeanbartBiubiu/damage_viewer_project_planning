package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillTriggerStartProcessActionDetail(
    String processKey,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerActionDetail {

    public SkillTriggerStartProcessActionDetail {
        processKey = trim(processKey);
        foreignFields = SkillTriggerDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerStartProcessActionDetail(String processKey) {
        this(processKey, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillTriggerStartProcessActionDetail fromJson(
        @JsonProperty("processKey") String processKey,
        @JsonProperty("effectKey") JsonNode effectKey,
        @JsonProperty("failureReason") JsonNode failureReason,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerStartProcessActionDetail(
            processKey,
            SkillTriggerDetailFieldCapture.captureForeign("effectKey", effectKey, "failureReason", failureReason),
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
