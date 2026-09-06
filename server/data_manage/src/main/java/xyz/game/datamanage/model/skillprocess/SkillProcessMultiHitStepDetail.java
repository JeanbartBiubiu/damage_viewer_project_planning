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

public record SkillProcessMultiHitStepDetail(
    @Valid
    SkillNumericValue repeatCountValue,
    @Valid
    SkillNumericValue intervalValue,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillProcessStepDetail {

    public SkillProcessMultiHitStepDetail {
        foreignFields = SkillProcessDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillProcessDetailFieldCapture.normalize(unknownFields);
    }

    public SkillProcessMultiHitStepDetail(SkillNumericValue repeatCountValue, SkillNumericValue intervalValue) {
        this(repeatCountValue, intervalValue, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillProcessMultiHitStepDetail fromJson(
        @JsonProperty("repeatCountValue") SkillNumericValue repeatCountValue,
        @JsonProperty("intervalValue") SkillNumericValue intervalValue,
        @JsonProperty("delayValue") JsonNode delayValue,
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
        return new SkillProcessMultiHitStepDetail(
            repeatCountValue,
            intervalValue,
            SkillProcessDetailFieldCapture.captureForeign(
                "delayValue", delayValue,
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
