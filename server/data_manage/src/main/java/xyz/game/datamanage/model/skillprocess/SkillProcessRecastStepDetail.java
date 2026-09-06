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

public record SkillProcessRecastStepDetail(
    @Valid
    SkillNumericValue windowValue,
    @Valid
    SkillNumericValue maximumRecastCountValue,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillProcessStepDetail {

    public SkillProcessRecastStepDetail {
        foreignFields = SkillProcessDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillProcessDetailFieldCapture.normalize(unknownFields);
    }

    public SkillProcessRecastStepDetail(SkillNumericValue windowValue, SkillNumericValue maximumRecastCountValue) {
        this(windowValue, maximumRecastCountValue, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillProcessRecastStepDetail fromJson(
        @JsonProperty("windowValue") SkillNumericValue windowValue,
        @JsonProperty("maximumRecastCountValue") SkillNumericValue maximumRecastCountValue,
        @JsonProperty("delayValue") JsonNode delayValue,
        @JsonProperty("repeatCountValue") JsonNode repeatCountValue,
        @JsonProperty("intervalValue") JsonNode intervalValue,
        @JsonProperty("firstExecution") JsonNode firstExecution,
        @JsonProperty("durationValue") JsonNode durationValue,
        @JsonProperty("executionCountValue") JsonNode executionCountValue,
        @JsonProperty("minimumChargeValue") JsonNode minimumChargeValue,
        @JsonProperty("maximumChargeValue") JsonNode maximumChargeValue,
        @JsonProperty("releaseAtMaximum") JsonNode releaseAtMaximum,
        @JsonProperty("consumeMoment") JsonNode consumeMoment,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillProcessRecastStepDetail(
            windowValue,
            maximumRecastCountValue,
            SkillProcessDetailFieldCapture.captureForeign(
                "delayValue", delayValue,
                "repeatCountValue", repeatCountValue,
                "intervalValue", intervalValue,
                "firstExecution", firstExecution,
                "durationValue", durationValue,
                "executionCountValue", executionCountValue,
                "minimumChargeValue", minimumChargeValue,
                "maximumChargeValue", maximumChargeValue,
                "releaseAtMaximum", releaseAtMaximum,
                "consumeMoment", consumeMoment
            ),
            SkillProcessDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
