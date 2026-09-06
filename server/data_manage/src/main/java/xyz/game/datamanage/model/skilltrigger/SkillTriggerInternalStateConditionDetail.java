package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import java.util.Map;
import java.util.Set;
import xyz.game.datamanage.model.value.SkillNumericValue;

public record SkillTriggerInternalStateConditionDetail(
    String stateKey,
    SkillTriggerInternalStateValueKind valueKind,
    String optionKey,
    Boolean expectedBoolean,
    SkillTriggerComparator comparator,
    @Valid
    SkillNumericValue comparisonValue,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerConditionDetail {

    public SkillTriggerInternalStateConditionDetail {
        stateKey = trim(stateKey);
        optionKey = trim(optionKey);
        foreignFields = SkillTriggerDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerInternalStateConditionDetail(
        String stateKey,
        SkillTriggerInternalStateValueKind valueKind,
        String optionKey,
        Boolean expectedBoolean,
        SkillTriggerComparator comparator,
        SkillNumericValue comparisonValue
    ) {
        this(stateKey, valueKind, optionKey, expectedBoolean, comparator, comparisonValue, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillTriggerInternalStateConditionDetail fromJson(
        @JsonProperty("stateKey") String stateKey,
        @JsonProperty("valueKind") SkillTriggerInternalStateValueKind valueKind,
        @JsonProperty("optionKey") String optionKey,
        @JsonProperty("expectedBoolean") Boolean expectedBoolean,
        @JsonProperty("comparator") SkillTriggerComparator comparator,
        @JsonProperty("comparisonValue") SkillNumericValue comparisonValue,
        @JsonProperty("statusKey") JsonNode statusKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerInternalStateConditionDetail(
            stateKey,
            valueKind,
            optionKey,
            expectedBoolean,
            comparator,
            comparisonValue,
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
