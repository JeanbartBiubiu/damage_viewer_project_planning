package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillTriggerInternalStateConditionDetail(
    String stateKey,
    SkillTriggerInternalStateValueKind valueKind,
    String optionKey,
    Boolean expectedBoolean,
    SkillTriggerComparator comparator,
    String comparisonFormulaKey,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerConditionDetail {

    public SkillTriggerInternalStateConditionDetail {
        stateKey = trim(stateKey);
        optionKey = trim(optionKey);
        comparisonFormulaKey = trim(comparisonFormulaKey);
        foreignFields = SkillTriggerDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerInternalStateConditionDetail(
        String stateKey,
        SkillTriggerInternalStateValueKind valueKind,
        String optionKey,
        Boolean expectedBoolean,
        SkillTriggerComparator comparator,
        String comparisonFormulaKey
    ) {
        this(stateKey, valueKind, optionKey, expectedBoolean, comparator, comparisonFormulaKey, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillTriggerInternalStateConditionDetail fromJson(
        @JsonProperty("stateKey") String stateKey,
        @JsonProperty("valueKind") SkillTriggerInternalStateValueKind valueKind,
        @JsonProperty("optionKey") String optionKey,
        @JsonProperty("expectedBoolean") Boolean expectedBoolean,
        @JsonProperty("comparator") SkillTriggerComparator comparator,
        @JsonProperty("comparisonFormulaKey") String comparisonFormulaKey,
        @JsonProperty("statusKey") JsonNode statusKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerInternalStateConditionDetail(
            stateKey,
            valueKind,
            optionKey,
            expectedBoolean,
            comparator,
            comparisonFormulaKey,
            SkillTriggerDetailFieldCapture.captureForeign("statusKey", statusKey),
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
