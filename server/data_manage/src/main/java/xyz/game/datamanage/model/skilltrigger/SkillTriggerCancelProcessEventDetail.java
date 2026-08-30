package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillTriggerCancelProcessEventDetail(
    String processKey,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerEventDetail {

    public SkillTriggerCancelProcessEventDetail {
        processKey = trimToNull(processKey);
        foreignFields = SkillTriggerDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerCancelProcessEventDetail(String processKey) {
        this(processKey, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillTriggerCancelProcessEventDetail fromJson(
        @JsonProperty("processKey") String processKey,
        @JsonProperty("moment") JsonNode moment,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerCancelProcessEventDetail(
            processKey,
            SkillTriggerDetailFieldCapture.captureForeign("moment", moment),
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
