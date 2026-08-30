package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillTriggerStatusConditionDetail(
    SkillTriggerSubject subject,
    String statusKey,
    SkillTriggerStatusCheckKind checkKind,
    String sourceEffectKey,
    String sourceResultKey,
    SkillTriggerComparator comparator,
    String comparisonFormulaKey,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerConditionDetail {

    public SkillTriggerStatusConditionDetail {
        statusKey = trim(statusKey);
        sourceEffectKey = trim(sourceEffectKey);
        sourceResultKey = trim(sourceResultKey);
        comparisonFormulaKey = trim(comparisonFormulaKey);
        foreignFields = SkillTriggerDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerStatusConditionDetail(
        SkillTriggerSubject subject,
        String statusKey,
        SkillTriggerStatusCheckKind checkKind,
        String sourceEffectKey,
        String sourceResultKey,
        SkillTriggerComparator comparator,
        String comparisonFormulaKey
    ) {
        this(
            subject,
            statusKey,
            checkKind,
            sourceEffectKey,
            sourceResultKey,
            comparator,
            comparisonFormulaKey,
            Set.of(),
            Set.of()
        );
    }

    @JsonCreator
    static SkillTriggerStatusConditionDetail fromJson(
        @JsonProperty("subject") SkillTriggerSubject subject,
        @JsonProperty("statusKey") String statusKey,
        @JsonProperty("checkKind") SkillTriggerStatusCheckKind checkKind,
        @JsonProperty("sourceEffectKey") String sourceEffectKey,
        @JsonProperty("sourceResultKey") String sourceResultKey,
        @JsonProperty("comparator") SkillTriggerComparator comparator,
        @JsonProperty("comparisonFormulaKey") String comparisonFormulaKey,
        @JsonProperty("attributeKey") JsonNode attributeKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerStatusConditionDetail(
            subject,
            statusKey,
            checkKind,
            sourceEffectKey,
            sourceResultKey,
            comparator,
            comparisonFormulaKey,
            SkillTriggerDetailFieldCapture.captureForeign("attributeKey", attributeKey),
            SkillTriggerDetailFieldCapture.captureUnknown(unknown)
        );
    }

    private static String trim(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
