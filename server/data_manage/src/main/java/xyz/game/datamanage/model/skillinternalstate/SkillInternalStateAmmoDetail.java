package xyz.game.datamanage.model.skillinternalstate;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillInternalStateAmmoDetail(
    String initialValueFormulaKey,
    String maxValueFormulaKey,
    String recoveryIntervalFormulaKey,
    SkillInternalStateAmmoRecoveryMode recoveryMode,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillInternalStateDetail {

    public SkillInternalStateAmmoDetail {
        initialValueFormulaKey = initialValueFormulaKey == null ? null : initialValueFormulaKey.trim();
        maxValueFormulaKey = maxValueFormulaKey == null ? null : maxValueFormulaKey.trim();
        recoveryIntervalFormulaKey =
            recoveryIntervalFormulaKey == null ? null : recoveryIntervalFormulaKey.trim();
        foreignFields = SkillInternalStateDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillInternalStateDetailFieldCapture.normalize(unknownFields);
    }

    public SkillInternalStateAmmoDetail(
        String initialValueFormulaKey,
        String maxValueFormulaKey,
        String recoveryIntervalFormulaKey,
        SkillInternalStateAmmoRecoveryMode recoveryMode
    ) {
        this(
            initialValueFormulaKey,
            maxValueFormulaKey,
            recoveryIntervalFormulaKey,
            recoveryMode,
            Set.of(),
            Set.of()
        );
    }

    @JsonCreator
    static SkillInternalStateAmmoDetail fromJson(
        @JsonProperty("initialValueFormulaKey") String initialValueFormulaKey,
        @JsonProperty("maxValueFormulaKey") String maxValueFormulaKey,
        @JsonProperty("recoveryIntervalFormulaKey") String recoveryIntervalFormulaKey,
        @JsonProperty("recoveryMode") SkillInternalStateAmmoRecoveryMode recoveryMode,
        @JsonProperty("options") JsonNode options,
        @JsonProperty("initialEnabled") JsonNode initialEnabled,
        @JsonProperty("durationFormulaKey") JsonNode durationFormulaKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillInternalStateAmmoDetail(
            initialValueFormulaKey,
            maxValueFormulaKey,
            recoveryIntervalFormulaKey,
            recoveryMode,
            SkillInternalStateDetailFieldCapture.captureForeign(
                "options", options,
                "initialEnabled", initialEnabled,
                "durationFormulaKey", durationFormulaKey
            ),
            SkillInternalStateDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
