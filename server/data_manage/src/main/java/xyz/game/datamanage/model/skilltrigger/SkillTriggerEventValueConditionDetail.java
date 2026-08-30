package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillTriggerEventValueConditionDetail(
    SkillTriggerEventValueKey eventValueKey,
    SkillTriggerComparator comparator,
    String comparisonFormulaKey,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerConditionDetail {

    public SkillTriggerEventValueConditionDetail {
        comparisonFormulaKey = trim(comparisonFormulaKey);
        foreignFields = SkillTriggerDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerEventValueConditionDetail(
        SkillTriggerEventValueKey eventValueKey,
        SkillTriggerComparator comparator,
        String comparisonFormulaKey
    ) {
        this(eventValueKey, comparator, comparisonFormulaKey, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillTriggerEventValueConditionDetail fromJson(
        @JsonProperty("eventValueKey") SkillTriggerEventValueKey eventValueKey,
        @JsonProperty("comparator") SkillTriggerComparator comparator,
        @JsonProperty("comparisonFormulaKey") String comparisonFormulaKey,
        @JsonProperty("stateKey") JsonNode stateKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerEventValueConditionDetail(
            eventValueKey,
            comparator,
            comparisonFormulaKey,
            SkillTriggerDetailFieldCapture.captureForeign("stateKey", stateKey),
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
