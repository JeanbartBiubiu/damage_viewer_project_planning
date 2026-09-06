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

public record SkillTriggerEventValueConditionDetail(
    SkillTriggerEventValueKey eventValueKey,
    SkillTriggerComparator comparator,
    @Valid
    SkillNumericValue comparisonValue,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerConditionDetail {

    public SkillTriggerEventValueConditionDetail {
        foreignFields = SkillTriggerDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerEventValueConditionDetail(
        SkillTriggerEventValueKey eventValueKey,
        SkillTriggerComparator comparator,
        SkillNumericValue comparisonValue
    ) {
        this(eventValueKey, comparator, comparisonValue, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillTriggerEventValueConditionDetail fromJson(
        @JsonProperty("eventValueKey") SkillTriggerEventValueKey eventValueKey,
        @JsonProperty("comparator") SkillTriggerComparator comparator,
        @JsonProperty("comparisonValue") SkillNumericValue comparisonValue,
        @JsonProperty("stateKey") JsonNode stateKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerEventValueConditionDetail(
            eventValueKey,
            comparator,
            comparisonValue,
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
