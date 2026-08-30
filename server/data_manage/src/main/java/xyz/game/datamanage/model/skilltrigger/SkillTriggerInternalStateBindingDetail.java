package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillTriggerInternalStateBindingDetail(
    String stateKey,
    SkillTriggerInternalStateValueKind valueKind,
    String optionKey,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerRuntimeInputBindingDetail {

    public SkillTriggerInternalStateBindingDetail {
        stateKey = trim(stateKey);
        optionKey = trim(optionKey);
        foreignFields = SkillTriggerDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerInternalStateBindingDetail(
        String stateKey,
        SkillTriggerInternalStateValueKind valueKind,
        String optionKey
    ) {
        this(stateKey, valueKind, optionKey, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillTriggerInternalStateBindingDetail fromJson(
        @JsonProperty("stateKey") String stateKey,
        @JsonProperty("valueKind") SkillTriggerInternalStateValueKind valueKind,
        @JsonProperty("optionKey") String optionKey,
        @JsonProperty("statusKey") JsonNode statusKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerInternalStateBindingDetail(
            stateKey,
            valueKind,
            optionKey,
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
