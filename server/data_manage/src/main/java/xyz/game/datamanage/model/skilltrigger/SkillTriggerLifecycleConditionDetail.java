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

public record SkillTriggerLifecycleConditionDetail(
    String effectSkillKey,
    String effectKey,
    SkillTriggerSubject subject,
    SkillTriggerLifecycleCheckKind checkKind,
    SkillTriggerComparator comparator,
    @Valid SkillNumericValue comparisonValue,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerConditionDetail {
    public SkillTriggerLifecycleConditionDetail {
        effectSkillKey = effectSkillKey == null || effectSkillKey.isBlank() ? null : effectSkillKey.trim();
        effectKey = effectKey == null || effectKey.isBlank() ? null : effectKey.trim();
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerLifecycleConditionDetail(String effectSkillKey, String effectKey, SkillTriggerSubject subject,
            SkillTriggerLifecycleCheckKind checkKind, SkillTriggerComparator comparator, SkillNumericValue comparisonValue) {
        this(effectSkillKey, effectKey, subject, checkKind, comparator, comparisonValue, Set.of());
    }

    @Override @JsonIgnore public Set<String> foreignFields() { return Set.of(); }

    @JsonCreator
    static SkillTriggerLifecycleConditionDetail fromJson(
        @JsonProperty("effectSkillKey") String effectSkillKey,
        @JsonProperty("effectKey") String effectKey,
        @JsonProperty("subject") SkillTriggerSubject subject,
        @JsonProperty("checkKind") SkillTriggerLifecycleCheckKind checkKind,
        @JsonProperty("comparator") SkillTriggerComparator comparator,
        @JsonProperty("comparisonValue") SkillNumericValue comparisonValue,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerLifecycleConditionDetail(effectSkillKey, effectKey, subject, checkKind, comparator, comparisonValue,
            SkillTriggerDetailFieldCapture.captureUnknown(unknown));
    }
}
