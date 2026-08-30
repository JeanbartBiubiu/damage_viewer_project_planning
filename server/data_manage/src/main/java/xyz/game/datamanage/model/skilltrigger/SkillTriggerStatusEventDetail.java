package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillTriggerStatusEventDetail(
    SkillTriggerSubject subject,
    String statusKey,
    SkillTriggerStatusChangeKind change,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerEventDetail {

    public SkillTriggerStatusEventDetail {
        statusKey = trimToNull(statusKey);
        foreignFields = SkillTriggerDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerStatusEventDetail(
        SkillTriggerSubject subject,
        String statusKey,
        SkillTriggerStatusChangeKind change
    ) {
        this(subject, statusKey, change, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillTriggerStatusEventDetail fromJson(
        @JsonProperty("subject") SkillTriggerSubject subject,
        @JsonProperty("statusKey") String statusKey,
        @JsonProperty("change") SkillTriggerStatusChangeKind change,
        @JsonProperty("effectKey") JsonNode effectKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerStatusEventDetail(
            subject,
            statusKey,
            change,
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
