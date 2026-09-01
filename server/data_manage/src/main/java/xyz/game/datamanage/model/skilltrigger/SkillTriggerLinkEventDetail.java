package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillTriggerLinkEventDetail(
    String sourceSkillKey,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerEventDetail {

    public SkillTriggerLinkEventDetail {
        sourceSkillKey = trimToNull(sourceSkillKey);
        foreignFields = SkillTriggerDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerLinkEventDetail(String sourceSkillKey) {
        this(sourceSkillKey, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillTriggerLinkEventDetail fromJson(
        @JsonProperty("sourceSkillKey") String sourceSkillKey,
        @JsonProperty("useKind") JsonNode useKind,
        @JsonProperty("processKey") JsonNode processKey,
        @JsonProperty("effectKey") JsonNode effectKey,
        @JsonProperty("resultKey") JsonNode resultKey,
        @JsonProperty("shieldEffectKey") JsonNode shieldEffectKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerLinkEventDetail(
            sourceSkillKey,
            SkillTriggerDetailFieldCapture.captureForeign(
                "useKind", useKind,
                "processKey", processKey,
                "effectKey", effectKey,
                "resultKey", resultKey,
                "shieldEffectKey", shieldEffectKey
            ),
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
