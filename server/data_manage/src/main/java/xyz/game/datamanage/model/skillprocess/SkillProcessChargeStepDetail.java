package xyz.game.datamanage.model.skillprocess;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import java.util.Map;
import java.util.Set;
import xyz.game.datamanage.model.value.SkillNumericValue;

public record SkillProcessChargeStepDetail(
    @Valid
    SkillNumericValue minimumChargeValue,
    @Valid
    SkillNumericValue maximumChargeValue,
    Boolean releaseAtMaximum,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillProcessStepDetail {

    public SkillProcessChargeStepDetail {
        foreignFields = SkillProcessDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillProcessDetailFieldCapture.normalize(unknownFields);
    }

    public SkillProcessChargeStepDetail(
        SkillNumericValue minimumChargeValue,
        SkillNumericValue maximumChargeValue,
        Boolean releaseAtMaximum
    ) {
        this(minimumChargeValue, maximumChargeValue, releaseAtMaximum, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillProcessChargeStepDetail fromJson(
        @JsonProperty("minimumChargeValue") SkillNumericValue minimumChargeValue,
        @JsonProperty("maximumChargeValue") SkillNumericValue maximumChargeValue,
        @JsonProperty("releaseAtMaximum") Boolean releaseAtMaximum,
        @JsonProperty("delayValue") JsonNode delayValue,
        @JsonProperty("repeatCountValue") JsonNode repeatCountValue,
        @JsonProperty("intervalValue") JsonNode intervalValue,
        @JsonProperty("firstExecution") JsonNode firstExecution,
        @JsonProperty("durationValue") JsonNode durationValue,
        @JsonProperty("executionCountValue") JsonNode executionCountValue,
        @JsonProperty("windowValue") JsonNode windowValue,
        @JsonProperty("maximumRecastCountValue") JsonNode maximumRecastCountValue,
        @JsonProperty("consumeMoment") JsonNode consumeMoment,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillProcessChargeStepDetail(
            minimumChargeValue,
            maximumChargeValue,
            releaseAtMaximum,
            SkillProcessDetailFieldCapture.captureForeign(
                "delayValue", delayValue,
                "repeatCountValue", repeatCountValue,
                "intervalValue", intervalValue,
                "firstExecution", firstExecution,
                "durationValue", durationValue,
                "executionCountValue", executionCountValue,
                "windowValue", windowValue,
                "maximumRecastCountValue", maximumRecastCountValue,
                "consumeMoment", consumeMoment
            ),
            SkillProcessDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
