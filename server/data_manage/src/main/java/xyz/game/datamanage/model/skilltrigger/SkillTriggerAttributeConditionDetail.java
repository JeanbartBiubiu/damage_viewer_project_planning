package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import java.util.Map;
import java.util.Set;
import xyz.game.datamanage.model.skillformula.AttributeValueKind;
import xyz.game.datamanage.model.value.SkillNumericValue;

public record SkillTriggerAttributeConditionDetail(
    SkillTriggerSubject subject,
    String attributeKey,
    AttributeValueKind attributeValueKind,
    SkillTriggerComparator comparator,
    @Valid
    SkillNumericValue comparisonValue,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerConditionDetail {

    public SkillTriggerAttributeConditionDetail {
        attributeKey = trim(attributeKey);
        foreignFields = SkillTriggerDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerAttributeConditionDetail(
        SkillTriggerSubject subject,
        String attributeKey,
        AttributeValueKind attributeValueKind,
        SkillTriggerComparator comparator,
        SkillNumericValue comparisonValue
    ) {
        this(subject, attributeKey, attributeValueKind, comparator, comparisonValue, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillTriggerAttributeConditionDetail fromJson(
        @JsonProperty("subject") SkillTriggerSubject subject,
        @JsonProperty("attributeKey") String attributeKey,
        @JsonProperty("attributeValueKind") AttributeValueKind attributeValueKind,
        @JsonProperty("comparator") SkillTriggerComparator comparator,
        @JsonProperty("comparisonValue") SkillNumericValue comparisonValue,
        @JsonProperty("statusKey") JsonNode statusKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerAttributeConditionDetail(
            subject,
            attributeKey,
            attributeValueKind,
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
