package xyz.game.datamanage.model.skilleffect;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillEffectShieldReceivedModifierDetail(
    String modifierZoneKey,
    SkillEffectModifierOperation operation,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillEffectResultDetail {
    public SkillEffectShieldReceivedModifierDetail {
        modifierZoneKey = modifierZoneKey == null ? null : modifierZoneKey.trim();
        foreignFields = SkillEffectDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillEffectDetailFieldCapture.normalize(unknownFields);
    }

    public SkillEffectShieldReceivedModifierDetail(String modifierZoneKey, SkillEffectModifierOperation operation) {
        this(modifierZoneKey, operation, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillEffectShieldReceivedModifierDetail fromJson(
        @JsonProperty("modifierZoneKey") String modifierZoneKey,
        @JsonProperty("operation") SkillEffectModifierOperation operation,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillEffectShieldReceivedModifierDetail(
            modifierZoneKey, operation, Set.of(), SkillEffectDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
