package xyz.game.datamanage.model.skillprocess;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillProcessEmpoweredAttackStepDetail(
    String windowFormulaKey,
    SkillProcessEmpoweredConsumeMoment consumeMoment,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillProcessStepDetail {

    public SkillProcessEmpoweredAttackStepDetail {
        windowFormulaKey = windowFormulaKey == null ? null : windowFormulaKey.trim();
        foreignFields = SkillProcessDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillProcessDetailFieldCapture.normalize(unknownFields);
    }

    public SkillProcessEmpoweredAttackStepDetail(
        String windowFormulaKey,
        SkillProcessEmpoweredConsumeMoment consumeMoment
    ) {
        this(windowFormulaKey, consumeMoment, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillProcessEmpoweredAttackStepDetail fromJson(
        @JsonProperty("windowFormulaKey") String windowFormulaKey,
        @JsonProperty("consumeMoment") SkillProcessEmpoweredConsumeMoment consumeMoment,
        @JsonProperty("delayFormulaKey") JsonNode delayFormulaKey,
        @JsonProperty("repeatCountFormulaKey") JsonNode repeatCountFormulaKey,
        @JsonProperty("intervalFormulaKey") JsonNode intervalFormulaKey,
        @JsonProperty("firstExecution") JsonNode firstExecution,
        @JsonProperty("durationFormulaKey") JsonNode durationFormulaKey,
        @JsonProperty("executionCountFormulaKey") JsonNode executionCountFormulaKey,
        @JsonProperty("minimumChargeFormulaKey") JsonNode minimumChargeFormulaKey,
        @JsonProperty("maximumChargeFormulaKey") JsonNode maximumChargeFormulaKey,
        @JsonProperty("releaseAtMaximum") JsonNode releaseAtMaximum,
        @JsonProperty("maximumRecastCountFormulaKey") JsonNode maximumRecastCountFormulaKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillProcessEmpoweredAttackStepDetail(
            windowFormulaKey,
            consumeMoment,
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
                "maximumRecastCountFormulaKey", maximumRecastCountFormulaKey
            ),
            SkillProcessDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
