package xyz.game.datamanage.model.skillprocess;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillProcessMultiHitStepDetail(
    String repeatCountFormulaKey,
    String intervalFormulaKey,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillProcessStepDetail {

    public SkillProcessMultiHitStepDetail {
        repeatCountFormulaKey = repeatCountFormulaKey == null ? null : repeatCountFormulaKey.trim();
        intervalFormulaKey = intervalFormulaKey == null || intervalFormulaKey.isBlank()
            ? null
            : intervalFormulaKey.trim();
        foreignFields = SkillProcessDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillProcessDetailFieldCapture.normalize(unknownFields);
    }

    public SkillProcessMultiHitStepDetail(String repeatCountFormulaKey, String intervalFormulaKey) {
        this(repeatCountFormulaKey, intervalFormulaKey, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillProcessMultiHitStepDetail fromJson(
        @JsonProperty("repeatCountFormulaKey") String repeatCountFormulaKey,
        @JsonProperty("intervalFormulaKey") String intervalFormulaKey,
        @JsonProperty("delayFormulaKey") JsonNode delayFormulaKey,
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
        return new SkillProcessMultiHitStepDetail(
            repeatCountFormulaKey,
            intervalFormulaKey,
            SkillProcessDetailFieldCapture.captureForeign(
                "delayFormulaKey", delayFormulaKey,
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
