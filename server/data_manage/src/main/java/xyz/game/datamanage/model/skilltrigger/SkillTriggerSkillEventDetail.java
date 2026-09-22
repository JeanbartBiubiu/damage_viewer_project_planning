package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillTriggerSkillEventDetail(
    String sourceSkillKey,
    SkillTriggerEventUseKind useKind,
    @JsonInclude(JsonInclude.Include.NON_NULL)
    SkillTriggerCastPhase castPhase,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerEventDetail {

    public SkillTriggerSkillEventDetail {
        sourceSkillKey = trimToNull(sourceSkillKey);
        foreignFields = SkillTriggerDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerSkillEventDetail(String sourceSkillKey, SkillTriggerEventUseKind useKind) {
        this(sourceSkillKey, useKind, null, Set.of(), Set.of());
    }

    public SkillTriggerSkillEventDetail(
        String sourceSkillKey,
        SkillTriggerEventUseKind useKind,
        SkillTriggerCastPhase castPhase
    ) {
        this(sourceSkillKey, useKind, castPhase, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillTriggerSkillEventDetail fromJson(
        @JsonProperty("sourceSkillKey") String sourceSkillKey,
        @JsonProperty("useKind") SkillTriggerEventUseKind useKind,
        @JsonProperty("castPhase") SkillTriggerCastPhase castPhase,
        @JsonProperty("processKey") JsonNode processKey,
        @JsonProperty("effectKey") JsonNode effectKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerSkillEventDetail(
            sourceSkillKey,
            useKind,
            castPhase,
            SkillTriggerDetailFieldCapture.captureForeign("processKey", processKey, "effectKey", effectKey),
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
