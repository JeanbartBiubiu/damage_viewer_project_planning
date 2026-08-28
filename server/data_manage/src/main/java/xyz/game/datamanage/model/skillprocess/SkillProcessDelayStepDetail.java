package xyz.game.datamanage.model.skillprocess;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillProcessDelayStepDetail(
    String delayFormulaKey,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillProcessStepDetail {

    public SkillProcessDelayStepDetail {
        delayFormulaKey = delayFormulaKey == null ? null : delayFormulaKey.trim();
        foreignFields = SkillProcessDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillProcessDetailFieldCapture.normalize(unknownFields);
    }

    public SkillProcessDelayStepDetail(String delayFormulaKey) {
        this(delayFormulaKey, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillProcessDelayStepDetail fromJson(
        @JsonProperty("delayFormulaKey") String delayFormulaKey,
        @JsonProperty("repeatCountFormulaKey") JsonNode repeatCountFormulaKey,
        @JsonProperty("intervalFormulaKey") JsonNode intervalFormulaKey,
        @JsonProperty("firstExecution") JsonNode firstExecution,
        @JsonProperty("durationFormulaKey") JsonNode durationFormulaKey,
        @JsonProperty("executionCountFormulaKey") JsonNode executionCountFormulaKey,
        @JsonProperty("minimumChargeFormulaKey") JsonNode minimumChargeFormulaKey,
        @JsonProperty("maximumChargeFormulaKey") JsonNode maximumChargeFormulaKey,
        @JsonProperty("releaseAtMaximum") JsonNode releaseAtMaximum,
        @JsonProperty("windowFormulaKey") JsonNode windowFormulaKey,
        @JsonProperty("maximumRecastCountFormulaKey") JsonNode maximumRecastCountFormulaKey,
        @JsonProperty("consumeMoment") JsonNode consumeMoment,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillProcessDelayStepDetail(
            delayFormulaKey,
            SkillProcessDetailFieldCapture.captureForeign(
                "repeatCountFormulaKey", repeatCountFormulaKey,
                "intervalFormulaKey", intervalFormulaKey,
                "firstExecution", firstExecution,
                "durationFormulaKey", durationFormulaKey,
                "executionCountFormulaKey", executionCountFormulaKey,
                "minimumChargeFormulaKey", minimumChargeFormulaKey,
                "maximumChargeFormulaKey", maximumChargeFormulaKey,
                "releaseAtMaximum", releaseAtMaximum,
                "windowFormulaKey", windowFormulaKey,
                "maximumRecastCountFormulaKey", maximumRecastCountFormulaKey,
                "consumeMoment", consumeMoment
            ),
            SkillProcessDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
