package xyz.game.datamanage.model.skillprocess;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillProcessImmediateStepDetail(
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillProcessStepDetail {

    public SkillProcessImmediateStepDetail {
        foreignFields = SkillProcessDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillProcessDetailFieldCapture.normalize(unknownFields);
    }

    public SkillProcessImmediateStepDetail() {
        this(Set.of(), Set.of());
    }

    @JsonCreator
    static SkillProcessImmediateStepDetail fromJson(
        @JsonProperty("delayValue") JsonNode delayValue,
        @JsonProperty("repeatCountValue") JsonNode repeatCountValue,
        @JsonProperty("intervalValue") JsonNode intervalValue,
        @JsonProperty("firstExecution") JsonNode firstExecution,
        @JsonProperty("durationValue") JsonNode durationValue,
        @JsonProperty("executionCountValue") JsonNode executionCountValue,
        @JsonProperty("minimumChargeValue") JsonNode minimumChargeValue,
        @JsonProperty("maximumChargeValue") JsonNode maximumChargeValue,
        @JsonProperty("releaseAtMaximum") JsonNode releaseAtMaximum,
        @JsonProperty("windowValue") JsonNode windowValue,
        @JsonProperty("maximumRecastCountValue") JsonNode maximumRecastCountValue,
        @JsonProperty("consumeMoment") JsonNode consumeMoment,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillProcessImmediateStepDetail(
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
                "windowValue", windowValue,
                "maximumRecastCountValue", maximumRecastCountValue,
                "consumeMoment", consumeMoment
            ),
            SkillProcessDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
