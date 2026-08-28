package xyz.game.datamanage.model.skillprocess;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillProcessRecastStepDetail(
    String windowFormulaKey,
    String maximumRecastCountFormulaKey,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillProcessStepDetail {

    public SkillProcessRecastStepDetail {
        windowFormulaKey = windowFormulaKey == null ? null : windowFormulaKey.trim();
        maximumRecastCountFormulaKey =
            maximumRecastCountFormulaKey == null ? null : maximumRecastCountFormulaKey.trim();
        foreignFields = SkillProcessDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillProcessDetailFieldCapture.normalize(unknownFields);
    }

    public SkillProcessRecastStepDetail(String windowFormulaKey, String maximumRecastCountFormulaKey) {
        this(windowFormulaKey, maximumRecastCountFormulaKey, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillProcessRecastStepDetail fromJson(
        @JsonProperty("windowFormulaKey") String windowFormulaKey,
        @JsonProperty("maximumRecastCountFormulaKey") String maximumRecastCountFormulaKey,
        @JsonProperty("delayFormulaKey") JsonNode delayFormulaKey,
        @JsonProperty("repeatCountFormulaKey") JsonNode repeatCountFormulaKey,
        @JsonProperty("intervalFormulaKey") JsonNode intervalFormulaKey,
        @JsonProperty("firstExecution") JsonNode firstExecution,
        @JsonProperty("durationFormulaKey") JsonNode durationFormulaKey,
        @JsonProperty("executionCountFormulaKey") JsonNode executionCountFormulaKey,
        @JsonProperty("minimumChargeFormulaKey") JsonNode minimumChargeFormulaKey,
        @JsonProperty("maximumChargeFormulaKey") JsonNode maximumChargeFormulaKey,
        @JsonProperty("releaseAtMaximum") JsonNode releaseAtMaximum,
        @JsonProperty("consumeMoment") JsonNode consumeMoment,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillProcessRecastStepDetail(
            windowFormulaKey,
            maximumRecastCountFormulaKey,
            SkillProcessDetailFieldCapture.captureForeign(
                "delayFormulaKey", delayFormulaKey,
                "repeatCountFormulaKey", repeatCountFormulaKey,
                "intervalFormulaKey", intervalFormulaKey,
                "firstExecution", firstExecution,
                "durationFormulaKey", durationFormulaKey,
                "executionCountFormulaKey", executionCountFormulaKey,
                "minimumChargeFormulaKey", minimumChargeFormulaKey,
                "maximumChargeFormulaKey", maximumChargeFormulaKey,
                "releaseAtMaximum", releaseAtMaximum,
                "consumeMoment", consumeMoment
            ),
            SkillProcessDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
