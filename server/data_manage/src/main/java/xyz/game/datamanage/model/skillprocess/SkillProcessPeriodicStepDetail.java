package xyz.game.datamanage.model.skillprocess;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillProcessPeriodicStepDetail(
    String repeatCountFormulaKey,
    String intervalFormulaKey,
    SkillProcessFirstExecution firstExecution,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillProcessStepDetail {

    public SkillProcessPeriodicStepDetail {
        repeatCountFormulaKey = repeatCountFormulaKey == null ? null : repeatCountFormulaKey.trim();
        intervalFormulaKey = intervalFormulaKey == null ? null : intervalFormulaKey.trim();
        foreignFields = SkillProcessDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillProcessDetailFieldCapture.normalize(unknownFields);
    }

    public SkillProcessPeriodicStepDetail(
        String repeatCountFormulaKey,
        String intervalFormulaKey,
        SkillProcessFirstExecution firstExecution
    ) {
        this(repeatCountFormulaKey, intervalFormulaKey, firstExecution, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillProcessPeriodicStepDetail fromJson(
        @JsonProperty("repeatCountFormulaKey") String repeatCountFormulaKey,
        @JsonProperty("intervalFormulaKey") String intervalFormulaKey,
        @JsonProperty("firstExecution") SkillProcessFirstExecution firstExecution,
        @JsonProperty("delayFormulaKey") JsonNode delayFormulaKey,
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
        return new SkillProcessPeriodicStepDetail(
            repeatCountFormulaKey,
            intervalFormulaKey,
            firstExecution,
            SkillProcessDetailFieldCapture.captureForeign(
                "delayFormulaKey", delayFormulaKey,
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
