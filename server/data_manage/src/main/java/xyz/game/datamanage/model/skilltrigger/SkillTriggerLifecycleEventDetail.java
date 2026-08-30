package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillTriggerLifecycleEventDetail(
    String effectKey,
    SkillTriggerLifecycleEventMoment moment,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerEventDetail {

    public SkillTriggerLifecycleEventDetail {
        effectKey = trimToNull(effectKey);
        foreignFields = SkillTriggerDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerLifecycleEventDetail(String effectKey, SkillTriggerLifecycleEventMoment moment) {
        this(effectKey, moment, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillTriggerLifecycleEventDetail fromJson(
        @JsonProperty("effectKey") String effectKey,
        @JsonProperty("moment") SkillTriggerLifecycleEventMoment moment,
        @JsonProperty("resultKey") JsonNode resultKey,
        @JsonProperty("processKey") JsonNode processKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerLifecycleEventDetail(
            effectKey,
            moment,
            SkillTriggerDetailFieldCapture.captureForeign("resultKey", resultKey, "processKey", processKey),
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
