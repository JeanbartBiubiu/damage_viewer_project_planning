package xyz.game.datamanage.model.skillinternalstate;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import java.util.Map;
import java.util.Set;
import xyz.game.datamanage.model.value.SkillNumericValue;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuntimeInputBinding;

public record SkillInternalStateCounterDetail(
    @Valid
    SkillNumericValue initialValue,
    @Valid
    SkillNumericValue maxValue,
    @Valid
    SkillNumericValue durationValue,
    @Valid @JsonInclude(JsonInclude.Include.NON_NULL)
    SkillTriggerRuntimeInputBinding initialValueBinding,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillInternalStateDetail {

    public SkillInternalStateCounterDetail {
        foreignFields = SkillInternalStateDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillInternalStateDetailFieldCapture.normalize(unknownFields);
    }

    public SkillInternalStateCounterDetail(SkillNumericValue initialValue, SkillNumericValue maxValue) {
        this(initialValue, maxValue, null, null, Set.of(), Set.of());
    }

    public SkillInternalStateCounterDetail(SkillNumericValue initialValue, SkillNumericValue maxValue, SkillNumericValue durationValue) {
        this(initialValue, maxValue, durationValue, null, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillInternalStateCounterDetail fromJson(
        @JsonProperty("initialValue") SkillNumericValue initialValue,
        @JsonProperty("maxValue") SkillNumericValue maxValue,
        @JsonProperty("recoveryIntervalValue") JsonNode recoveryIntervalValue,
        @JsonProperty("recoveryMode") JsonNode recoveryMode,
        @JsonProperty("options") JsonNode options,
        @JsonProperty("initialEnabled") JsonNode initialEnabled,
        @JsonProperty("durationValue") SkillNumericValue durationValue,
        @JsonProperty("initialValueBinding") SkillTriggerRuntimeInputBinding initialValueBinding,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillInternalStateCounterDetail(
            initialValue,
            maxValue,
            durationValue,
            initialValueBinding,
            SkillInternalStateDetailFieldCapture.captureForeign(
                "recoveryIntervalValue", recoveryIntervalValue,
                "recoveryMode", recoveryMode,
                "options", options,
                "initialEnabled", initialEnabled
            ),
            SkillInternalStateDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
