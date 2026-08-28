package xyz.game.datamanage.model.skillinternalstate;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillInternalStateCooldownDetail(
    String durationFormulaKey,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillInternalStateDetail {

    public SkillInternalStateCooldownDetail {
        durationFormulaKey = durationFormulaKey == null ? null : durationFormulaKey.trim();
        foreignFields = SkillInternalStateDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillInternalStateDetailFieldCapture.normalize(unknownFields);
    }

    public SkillInternalStateCooldownDetail(String durationFormulaKey) {
        this(durationFormulaKey, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillInternalStateCooldownDetail fromJson(
        @JsonProperty("durationFormulaKey") String durationFormulaKey,
        @JsonProperty("initialValueFormulaKey") JsonNode initialValueFormulaKey,
        @JsonProperty("maxValueFormulaKey") JsonNode maxValueFormulaKey,
        @JsonProperty("recoveryIntervalFormulaKey") JsonNode recoveryIntervalFormulaKey,
        @JsonProperty("recoveryMode") JsonNode recoveryMode,
        @JsonProperty("options") JsonNode options,
        @JsonProperty("initialEnabled") JsonNode initialEnabled,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillInternalStateCooldownDetail(
            durationFormulaKey,
            SkillInternalStateDetailFieldCapture.captureForeign(
                "initialValueFormulaKey", initialValueFormulaKey,
                "maxValueFormulaKey", maxValueFormulaKey,
                "recoveryIntervalFormulaKey", recoveryIntervalFormulaKey,
                "recoveryMode", recoveryMode,
                "options", options,
                "initialEnabled", initialEnabled
            ),
            SkillInternalStateDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
