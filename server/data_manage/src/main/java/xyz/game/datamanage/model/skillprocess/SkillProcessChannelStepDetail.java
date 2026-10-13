package xyz.game.datamanage.model.skillprocess;

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

public record SkillProcessChannelStepDetail(
    @Valid
    SkillNumericValue durationValue,
    @Valid
    SkillNumericValue executionCountValue,
    SkillProcessFirstExecution firstExecution,
    @Valid @JsonInclude(JsonInclude.Include.NON_NULL)
    SkillNumericValue firstExecutionOffsetValue,
    @Valid @JsonInclude(JsonInclude.Include.NON_NULL)
    SkillNumericValue lastExecutionOffsetValue,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillProcessStepDetail {

    public SkillProcessChannelStepDetail {
        foreignFields = SkillProcessDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillProcessDetailFieldCapture.normalize(unknownFields);
    }

    public SkillProcessChannelStepDetail(
        SkillNumericValue durationValue,
        SkillNumericValue executionCountValue,
        SkillProcessFirstExecution firstExecution
    ) {
        this(durationValue, executionCountValue, firstExecution, null, null, Set.of(), Set.of());
    }

    public SkillProcessChannelStepDetail(
        SkillNumericValue durationValue,
        SkillNumericValue executionCountValue,
        SkillProcessFirstExecution firstExecution,
        SkillNumericValue firstExecutionOffsetValue,
        SkillNumericValue lastExecutionOffsetValue
    ) {
        this(durationValue, executionCountValue, firstExecution, firstExecutionOffsetValue, lastExecutionOffsetValue,
            Set.of(), Set.of());
    }

    @JsonCreator
    static SkillProcessChannelStepDetail fromJson(
        @JsonProperty("durationValue") SkillNumericValue durationValue,
        @JsonProperty("executionCountValue") SkillNumericValue executionCountValue,
        @JsonProperty("firstExecution") SkillProcessFirstExecution firstExecution,
        @JsonProperty("firstExecutionOffsetValue") JsonNode firstExecutionOffsetValue,
        @JsonProperty("lastExecutionOffsetValue") JsonNode lastExecutionOffsetValue,
        @JsonProperty("delayValue") JsonNode delayValue,
        @JsonProperty("repeatCountValue") JsonNode repeatCountValue,
        @JsonProperty("intervalValue") JsonNode intervalValue,
        @JsonProperty("minimumChargeValue") JsonNode minimumChargeValue,
        @JsonProperty("maximumChargeValue") JsonNode maximumChargeValue,
        @JsonProperty("releaseAtMaximum") JsonNode releaseAtMaximum,
        @JsonProperty("windowValue") JsonNode windowValue,
        @JsonProperty("maximumRecastCountValue") JsonNode maximumRecastCountValue,
        @JsonProperty("consumeMoment") JsonNode consumeMoment,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillProcessChannelStepDetail(
            durationValue,
            executionCountValue,
            firstExecution,
            SkillNumericValue.fromJson(firstExecutionOffsetValue),
            SkillNumericValue.fromJson(lastExecutionOffsetValue),
            SkillProcessDetailFieldCapture.captureForeign(
                "firstExecutionOffsetValue", firstExecution == SkillProcessFirstExecution.CUSTOM_WINDOW ? null : firstExecutionOffsetValue,
                "lastExecutionOffsetValue", firstExecution == SkillProcessFirstExecution.CUSTOM_WINDOW ? null : lastExecutionOffsetValue,
                "delayValue", delayValue,
                "repeatCountValue", repeatCountValue,
                "intervalValue", intervalValue,
                "minimumChargeValue", minimumChargeValue,
                "maximumChargeValue", maximumChargeValue,
                "releaseAtMaximum", releaseAtMaximum,
                "windowValue", windowValue,
                "maximumRecastCountValue", maximumRecastCountValue,
                "consumeMoment", consumeMoment
            ),
            SkillProcessDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
