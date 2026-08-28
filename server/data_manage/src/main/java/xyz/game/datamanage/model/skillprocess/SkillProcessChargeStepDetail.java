package xyz.game.datamanage.model.skillprocess;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillProcessChargeStepDetail(
    String minimumChargeFormulaKey,
    String maximumChargeFormulaKey,
    Boolean releaseAtMaximum,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillProcessStepDetail {

    public SkillProcessChargeStepDetail {
        minimumChargeFormulaKey = minimumChargeFormulaKey == null ? null : minimumChargeFormulaKey.trim();
        maximumChargeFormulaKey = maximumChargeFormulaKey == null ? null : maximumChargeFormulaKey.trim();
        foreignFields = SkillProcessDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillProcessDetailFieldCapture.normalize(unknownFields);
    }

    public SkillProcessChargeStepDetail(
        String minimumChargeFormulaKey,
        String maximumChargeFormulaKey,
        Boolean releaseAtMaximum
    ) {
        this(minimumChargeFormulaKey, maximumChargeFormulaKey, releaseAtMaximum, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillProcessChargeStepDetail fromJson(
        @JsonProperty("minimumChargeFormulaKey") String minimumChargeFormulaKey,
        @JsonProperty("maximumChargeFormulaKey") String maximumChargeFormulaKey,
        @JsonProperty("releaseAtMaximum") Boolean releaseAtMaximum,
        @JsonProperty("delayFormulaKey") JsonNode delayFormulaKey,
        @JsonProperty("repeatCountFormulaKey") JsonNode repeatCountFormulaKey,
        @JsonProperty("intervalFormulaKey") JsonNode intervalFormulaKey,
        @JsonProperty("firstExecution") JsonNode firstExecution,
        @JsonProperty("durationFormulaKey") JsonNode durationFormulaKey,
        @JsonProperty("executionCountFormulaKey") JsonNode executionCountFormulaKey,
        @JsonProperty("windowFormulaKey") JsonNode windowFormulaKey,
        @JsonProperty("maximumRecastCountFormulaKey") JsonNode maximumRecastCountFormulaKey,
        @JsonProperty("consumeMoment") JsonNode consumeMoment,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillProcessChargeStepDetail(
            minimumChargeFormulaKey,
            maximumChargeFormulaKey,
            releaseAtMaximum,
            SkillProcessDetailFieldCapture.captureForeign(
                "delayFormulaKey", delayFormulaKey,
                "repeatCountFormulaKey", repeatCountFormulaKey,
                "intervalFormulaKey", intervalFormulaKey,
                "firstExecution", firstExecution,
                "durationFormulaKey", durationFormulaKey,
                "executionCountFormulaKey", executionCountFormulaKey,
                "windowFormulaKey", windowFormulaKey,
                "maximumRecastCountFormulaKey", maximumRecastCountFormulaKey,
                "consumeMoment", consumeMoment
            ),
            SkillProcessDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
