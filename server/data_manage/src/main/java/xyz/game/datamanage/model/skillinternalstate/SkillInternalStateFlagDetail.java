package xyz.game.datamanage.model.skillinternalstate;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillInternalStateFlagDetail(
    Boolean initialEnabled,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillInternalStateDetail {

    public SkillInternalStateFlagDetail {
        foreignFields = SkillInternalStateDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillInternalStateDetailFieldCapture.normalize(unknownFields);
    }

    public SkillInternalStateFlagDetail(Boolean initialEnabled) {
        this(initialEnabled, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillInternalStateFlagDetail fromJson(
        @JsonProperty("initialEnabled") Boolean initialEnabled,
        @JsonProperty("initialValue") JsonNode initialValue,
        @JsonProperty("maxValue") JsonNode maxValue,
        @JsonProperty("recoveryIntervalValue") JsonNode recoveryIntervalValue,
        @JsonProperty("recoveryMode") JsonNode recoveryMode,
        @JsonProperty("options") JsonNode options,
        @JsonProperty("durationValue") JsonNode durationValue,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillInternalStateFlagDetail(
            initialEnabled,
            SkillInternalStateDetailFieldCapture.captureForeign(
                "initialValue", initialValue,
                "maxValue", maxValue,
                "recoveryIntervalValue", recoveryIntervalValue,
                "recoveryMode", recoveryMode,
                "options", options,
                "durationValue", durationValue
            ),
            SkillInternalStateDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
