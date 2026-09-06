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

public record SkillInternalStateAmmoDetail(
    @Valid
    SkillNumericValue initialValue,
    @Valid
    SkillNumericValue maxValue,
    @Valid
    SkillNumericValue recoveryIntervalValue,
    SkillInternalStateAmmoRecoveryMode recoveryMode,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillInternalStateDetail {

    public SkillInternalStateAmmoDetail {
        foreignFields = SkillInternalStateDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillInternalStateDetailFieldCapture.normalize(unknownFields);
    }

    public SkillInternalStateAmmoDetail(
        SkillNumericValue initialValue,
        SkillNumericValue maxValue,
        SkillNumericValue recoveryIntervalValue,
        SkillInternalStateAmmoRecoveryMode recoveryMode
    ) {
        this(
            initialValue,
            maxValue,
            recoveryIntervalValue,
            recoveryMode,
            Set.of(),
            Set.of()
        );
    }

    @JsonCreator
    static SkillInternalStateAmmoDetail fromJson(
        @JsonProperty("initialValue") SkillNumericValue initialValue,
        @JsonProperty("maxValue") SkillNumericValue maxValue,
        @JsonProperty("recoveryIntervalValue") SkillNumericValue recoveryIntervalValue,
        @JsonProperty("recoveryMode") SkillInternalStateAmmoRecoveryMode recoveryMode,
        @JsonProperty("options") JsonNode options,
        @JsonProperty("initialEnabled") JsonNode initialEnabled,
        @JsonProperty("durationValue") JsonNode durationValue,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillInternalStateAmmoDetail(
            initialValue,
            maxValue,
            recoveryIntervalValue,
            recoveryMode,
            SkillInternalStateDetailFieldCapture.captureForeign(
                "options", options,
                "initialEnabled", initialEnabled,
                "durationValue", durationValue
            ),
            SkillInternalStateDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
