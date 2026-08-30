package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillTriggerPriorResultBindingDetail(
    String sourceActionKey,
    String sourceResultKey,
    SkillTriggerPriorResultOutputKind outputKind,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerRuntimeInputBindingDetail {

    public SkillTriggerPriorResultBindingDetail {
        sourceActionKey = trim(sourceActionKey);
        sourceResultKey = trim(sourceResultKey);
        if (outputKind == null) {
            outputKind = SkillTriggerPriorResultOutputKind.CONFIGURED_VALUE;
        }
        foreignFields = SkillTriggerDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerPriorResultBindingDetail(
        String sourceActionKey,
        String sourceResultKey,
        SkillTriggerPriorResultOutputKind outputKind
    ) {
        this(sourceActionKey, sourceResultKey, outputKind, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillTriggerPriorResultBindingDetail fromJson(
        @JsonProperty("sourceActionKey") String sourceActionKey,
        @JsonProperty("sourceResultKey") String sourceResultKey,
        @JsonProperty("outputKind") SkillTriggerPriorResultOutputKind outputKind,
        @JsonProperty("sourceEffectKey") JsonNode sourceEffectKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerPriorResultBindingDetail(
            sourceActionKey,
            sourceResultKey,
            outputKind,
            SkillTriggerDetailFieldCapture.captureForeign("sourceEffectKey", sourceEffectKey),
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
