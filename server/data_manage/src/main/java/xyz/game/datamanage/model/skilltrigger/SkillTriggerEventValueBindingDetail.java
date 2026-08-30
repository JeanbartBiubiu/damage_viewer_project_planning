package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillTriggerEventValueBindingDetail(
    SkillTriggerEventValueKey eventValueKey,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerRuntimeInputBindingDetail {

    public SkillTriggerEventValueBindingDetail {
        foreignFields = SkillTriggerDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerEventValueBindingDetail(SkillTriggerEventValueKey eventValueKey) {
        this(eventValueKey, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillTriggerEventValueBindingDetail fromJson(
        @JsonProperty("eventValueKey") SkillTriggerEventValueKey eventValueKey,
        @JsonProperty("sourceActionKey") JsonNode sourceActionKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerEventValueBindingDetail(
            eventValueKey,
            SkillTriggerDetailFieldCapture.captureForeign("sourceActionKey", sourceActionKey),
            SkillTriggerDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
