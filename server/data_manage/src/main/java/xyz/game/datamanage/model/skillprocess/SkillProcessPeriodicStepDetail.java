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

public record SkillProcessPeriodicStepDetail(
    @Valid
    SkillNumericValue repeatCountValue,
    @Valid
    SkillNumericValue intervalValue,
    SkillProcessFirstExecution firstExecution,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillProcessStepDetail {

    public SkillProcessPeriodicStepDetail {
        foreignFields = SkillProcessDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillProcessDetailFieldCapture.normalize(unknownFields);
    }

    public SkillProcessPeriodicStepDetail(
        SkillNumericValue repeatCountValue,
        SkillNumericValue intervalValue,
        SkillProcessFirstExecution firstExecution
    ) {
        this(repeatCountValue, intervalValue, firstExecution, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillProcessPeriodicStepDetail fromJson(
        @JsonProperty("repeatCountValue") SkillNumericValue repeatCountValue,
        @JsonProperty("intervalValue") SkillNumericValue intervalValue,
        @JsonProperty("firstExecution") SkillProcessFirstExecution firstExecution,
        @JsonProperty("delayValue") JsonNode delayValue,
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
        return new SkillProcessPeriodicStepDetail(
            repeatCountValue,
            intervalValue,
            firstExecution,
            SkillProcessDetailFieldCapture.captureForeign(
                "delayValue", delayValue,
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
