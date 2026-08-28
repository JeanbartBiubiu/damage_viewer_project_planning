package xyz.game.datamanage.model.skillprocess;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillProcessChannelStepDetail(
    String durationFormulaKey,
    String executionCountFormulaKey,
    SkillProcessFirstExecution firstExecution,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillProcessStepDetail {

    public SkillProcessChannelStepDetail {
        durationFormulaKey = durationFormulaKey == null ? null : durationFormulaKey.trim();
        executionCountFormulaKey = executionCountFormulaKey == null ? null : executionCountFormulaKey.trim();
        foreignFields = SkillProcessDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillProcessDetailFieldCapture.normalize(unknownFields);
    }

    public SkillProcessChannelStepDetail(
        String durationFormulaKey,
        String executionCountFormulaKey,
        SkillProcessFirstExecution firstExecution
    ) {
        this(durationFormulaKey, executionCountFormulaKey, firstExecution, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillProcessChannelStepDetail fromJson(
        @JsonProperty("durationFormulaKey") String durationFormulaKey,
        @JsonProperty("executionCountFormulaKey") String executionCountFormulaKey,
        @JsonProperty("firstExecution") SkillProcessFirstExecution firstExecution,
        @JsonProperty("delayFormulaKey") JsonNode delayFormulaKey,
        @JsonProperty("repeatCountFormulaKey") JsonNode repeatCountFormulaKey,
        @JsonProperty("intervalFormulaKey") JsonNode intervalFormulaKey,
        @JsonProperty("minimumChargeFormulaKey") JsonNode minimumChargeFormulaKey,
        @JsonProperty("maximumChargeFormulaKey") JsonNode maximumChargeFormulaKey,
        @JsonProperty("releaseAtMaximum") JsonNode releaseAtMaximum,
        @JsonProperty("windowFormulaKey") JsonNode windowFormulaKey,
        @JsonProperty("maximumRecastCountFormulaKey") JsonNode maximumRecastCountFormulaKey,
        @JsonProperty("consumeMoment") JsonNode consumeMoment,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillProcessChannelStepDetail(
            durationFormulaKey,
            executionCountFormulaKey,
            firstExecution,
            SkillProcessDetailFieldCapture.captureForeign(
                "delayFormulaKey", delayFormulaKey,
                "repeatCountFormulaKey", repeatCountFormulaKey,
                "intervalFormulaKey", intervalFormulaKey,
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
