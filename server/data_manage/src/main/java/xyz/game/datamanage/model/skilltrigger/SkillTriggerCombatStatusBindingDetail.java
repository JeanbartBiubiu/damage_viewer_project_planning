package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillTriggerCombatStatusBindingDetail(
    SkillTriggerSubject subject,
    String statusKey,
    SkillTriggerCombatStatusValueKind valueKind,
    String sourceEffectKey,
    String sourceResultKey,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerRuntimeInputBindingDetail {

    public SkillTriggerCombatStatusBindingDetail {
        statusKey = trim(statusKey);
        sourceEffectKey = trim(sourceEffectKey);
        sourceResultKey = trim(sourceResultKey);
        foreignFields = SkillTriggerDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerCombatStatusBindingDetail(
        SkillTriggerSubject subject,
        String statusKey,
        SkillTriggerCombatStatusValueKind valueKind,
        String sourceEffectKey,
        String sourceResultKey
    ) {
        this(subject, statusKey, valueKind, sourceEffectKey, sourceResultKey, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillTriggerCombatStatusBindingDetail fromJson(
        @JsonProperty("subject") SkillTriggerSubject subject,
        @JsonProperty("statusKey") String statusKey,
        @JsonProperty("valueKind") SkillTriggerCombatStatusValueKind valueKind,
        @JsonProperty("sourceEffectKey") String sourceEffectKey,
        @JsonProperty("sourceResultKey") String sourceResultKey,
        @JsonProperty("stateKey") JsonNode stateKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerCombatStatusBindingDetail(
            subject,
            statusKey,
            valueKind,
            sourceEffectKey,
            sourceResultKey,
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
