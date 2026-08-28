package xyz.game.datamanage.model.skillinternalstate;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillInternalStateCounterDetail(
    String initialValueFormulaKey,
    String maxValueFormulaKey,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillInternalStateDetail {

    public SkillInternalStateCounterDetail {
        initialValueFormulaKey = initialValueFormulaKey == null ? null : initialValueFormulaKey.trim();
        maxValueFormulaKey = maxValueFormulaKey == null ? null : maxValueFormulaKey.trim();
        foreignFields = SkillInternalStateDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillInternalStateDetailFieldCapture.normalize(unknownFields);
    }

    public SkillInternalStateCounterDetail(String initialValueFormulaKey, String maxValueFormulaKey) {
        this(initialValueFormulaKey, maxValueFormulaKey, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillInternalStateCounterDetail fromJson(
        @JsonProperty("initialValueFormulaKey") String initialValueFormulaKey,
        @JsonProperty("maxValueFormulaKey") String maxValueFormulaKey,
        @JsonProperty("recoveryIntervalFormulaKey") JsonNode recoveryIntervalFormulaKey,
        @JsonProperty("recoveryMode") JsonNode recoveryMode,
        @JsonProperty("options") JsonNode options,
        @JsonProperty("initialEnabled") JsonNode initialEnabled,
        @JsonProperty("durationFormulaKey") JsonNode durationFormulaKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillInternalStateCounterDetail(
            initialValueFormulaKey,
            maxValueFormulaKey,
            SkillInternalStateDetailFieldCapture.captureForeign(
                "recoveryIntervalFormulaKey", recoveryIntervalFormulaKey,
                "recoveryMode", recoveryMode,
                "options", options,
                "initialEnabled", initialEnabled,
                "durationFormulaKey", durationFormulaKey
            ),
            SkillInternalStateDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
