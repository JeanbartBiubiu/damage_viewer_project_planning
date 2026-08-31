package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillTriggerSpellShieldBlockedEventDetail(
    String shieldEffectKey,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerEventDetail {

    public SkillTriggerSpellShieldBlockedEventDetail {
        shieldEffectKey = trimToNull(shieldEffectKey);
        foreignFields = SkillTriggerDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerSpellShieldBlockedEventDetail(String shieldEffectKey) {
        this(shieldEffectKey, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillTriggerSpellShieldBlockedEventDetail fromJson(
        @JsonProperty("shieldEffectKey") String shieldEffectKey,
        @JsonProperty("effectKey") JsonNode effectKey,
        @JsonProperty("resultKey") JsonNode resultKey,
        @JsonProperty("processKey") JsonNode processKey,
        @JsonProperty("moment") JsonNode moment,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerSpellShieldBlockedEventDetail(
            shieldEffectKey,
            SkillTriggerDetailFieldCapture.captureForeign(
                "effectKey", effectKey,
                "resultKey", resultKey,
                "processKey", processKey,
                "moment", moment
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
