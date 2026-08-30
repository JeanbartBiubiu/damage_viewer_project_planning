package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import java.util.Map;
import java.util.Set;
import xyz.game.datamanage.model.skillprocess.SkillProcessMoment;

public record SkillTriggerProcessEventDetail(
    String processKey,
    @Valid SkillProcessMoment moment,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerEventDetail {

    public SkillTriggerProcessEventDetail {
        processKey = trimToNull(processKey);
        foreignFields = SkillTriggerDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerProcessEventDetail(String processKey, SkillProcessMoment moment) {
        this(processKey, moment, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillTriggerProcessEventDetail fromJson(
        @JsonProperty("processKey") String processKey,
        @JsonProperty("moment") SkillProcessMoment moment,
        @JsonProperty("sourceSkillKey") JsonNode sourceSkillKey,
        @JsonProperty("useKind") JsonNode useKind,
        @JsonProperty("effectKey") JsonNode effectKey,
        @JsonProperty("resultKey") JsonNode resultKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerProcessEventDetail(
            processKey,
            moment,
            SkillTriggerDetailFieldCapture.captureForeign(
                "sourceSkillKey", sourceSkillKey,
                "useKind", useKind,
                "effectKey", effectKey,
                "resultKey", resultKey
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
