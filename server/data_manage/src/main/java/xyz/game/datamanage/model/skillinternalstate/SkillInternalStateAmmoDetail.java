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

public record SkillInternalStateAmmoDetail(
    @Valid
    SkillNumericValue initialValue,
    @Valid
    SkillNumericValue maxValue,
    @Valid
    SkillNumericValue recoveryIntervalValue,
    SkillInternalStateAmmoRecoveryMode recoveryMode,
    SkillInternalStateAmmoRecoveryStartCondition recoveryStartCondition,
    @Valid @JsonInclude(JsonInclude.Include.NON_NULL)
    SkillTriggerRuntimeInputBinding initialValueBinding,
    @Valid @JsonInclude(JsonInclude.Include.NON_NULL)
    SkillNumericValue initialRemainingValue,
    @Valid @JsonInclude(JsonInclude.Include.NON_NULL)
    SkillTriggerRuntimeInputBinding initialRemainingMsBinding,
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
        SkillInternalStateAmmoRecoveryMode recoveryMode,
        SkillInternalStateAmmoRecoveryStartCondition recoveryStartCondition
    ) {
        this(
            initialValue,
            maxValue,
            recoveryIntervalValue,
            recoveryMode,
            recoveryStartCondition,
            null,
            null,
            null,
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
        @JsonProperty("recoveryStartCondition") SkillInternalStateAmmoRecoveryStartCondition recoveryStartCondition,
        @JsonProperty("initialValueBinding") SkillTriggerRuntimeInputBinding initialValueBinding,
        @JsonProperty("initialRemainingValue") SkillNumericValue initialRemainingValue,
        @JsonProperty("initialRemainingMsBinding") SkillTriggerRuntimeInputBinding initialRemainingMsBinding,
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
            recoveryStartCondition,
            initialValueBinding,
            initialRemainingValue,
            initialRemainingMsBinding,
            SkillInternalStateDetailFieldCapture.captureForeign(
                "options", options,
                "initialEnabled", initialEnabled,
                "durationValue", durationValue
            ),
            SkillInternalStateDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
