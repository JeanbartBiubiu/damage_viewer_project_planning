package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillTriggerInternalStateEventDetail(
    String stateKey,
    SkillTriggerInternalStateChangeKind changeKind,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerEventDetail {

    public SkillTriggerInternalStateEventDetail {
        stateKey = trimToNull(stateKey);
        foreignFields = SkillTriggerDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerInternalStateEventDetail(String stateKey, SkillTriggerInternalStateChangeKind changeKind) {
        this(stateKey, changeKind, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillTriggerInternalStateEventDetail fromJson(
        @JsonProperty("stateKey") String stateKey,
        @JsonProperty("changeKind") SkillTriggerInternalStateChangeKind changeKind,
        @JsonProperty("effectKey") JsonNode effectKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerInternalStateEventDetail(
            stateKey,
            changeKind,
            SkillTriggerDetailFieldCapture.captureForeign("effectKey", effectKey),
            SkillTriggerDetailFieldCapture.captureUnknown(unknown)
        );
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
