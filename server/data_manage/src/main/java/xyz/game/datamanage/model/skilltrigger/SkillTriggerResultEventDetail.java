package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillTriggerResultEventDetail(
    String effectKey,
    String resultKey,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerEventDetail {

    public SkillTriggerResultEventDetail {
        effectKey = trimToNull(effectKey);
        resultKey = trimToNull(resultKey);
        foreignFields = SkillTriggerDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerResultEventDetail(String effectKey, String resultKey) {
        this(effectKey, resultKey, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillTriggerResultEventDetail fromJson(
        @JsonProperty("effectKey") String effectKey,
        @JsonProperty("resultKey") String resultKey,
        @JsonProperty("moment") JsonNode moment,
        @JsonProperty("processKey") JsonNode processKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerResultEventDetail(
            effectKey,
            resultKey,
            SkillTriggerDetailFieldCapture.captureForeign("moment", moment, "processKey", processKey),
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
