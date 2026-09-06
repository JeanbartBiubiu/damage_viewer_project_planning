package xyz.game.datamanage.model.skillinternalstate;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import java.util.Map;
import java.util.Set;
import xyz.game.datamanage.model.value.SkillNumericValue;

public record SkillInternalStateCooldownDetail(
    @Valid
    SkillNumericValue durationValue,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillInternalStateDetail {

    public SkillInternalStateCooldownDetail {
        foreignFields = SkillInternalStateDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillInternalStateDetailFieldCapture.normalize(unknownFields);
    }

    public SkillInternalStateCooldownDetail(SkillNumericValue durationValue) {
        this(durationValue, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillInternalStateCooldownDetail fromJson(
        @JsonProperty("durationValue") SkillNumericValue durationValue,
        @JsonProperty("initialValue") JsonNode initialValue,
        @JsonProperty("maxValue") JsonNode maxValue,
        @JsonProperty("recoveryIntervalValue") JsonNode recoveryIntervalValue,
        @JsonProperty("recoveryMode") JsonNode recoveryMode,
        @JsonProperty("options") JsonNode options,
        @JsonProperty("initialEnabled") JsonNode initialEnabled,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillInternalStateCooldownDetail(
            durationValue,
            SkillInternalStateDetailFieldCapture.captureForeign(
                "initialValue", initialValue,
                "maxValue", maxValue,
                "recoveryIntervalValue", recoveryIntervalValue,
                "recoveryMode", recoveryMode,
                "options", options,
                "initialEnabled", initialEnabled
            ),
            SkillInternalStateDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
