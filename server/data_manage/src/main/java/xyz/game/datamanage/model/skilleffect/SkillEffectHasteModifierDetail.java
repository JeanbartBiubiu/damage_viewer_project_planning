package xyz.game.datamanage.model.skilleffect;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillEffectHasteModifierDetail(
    SkillEffectAffectedSkillScope affectedSkillScope,
    SkillEffectModifierOperation operation,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillEffectResultDetail {

    public SkillEffectHasteModifierDetail {
        foreignFields = SkillEffectDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillEffectDetailFieldCapture.normalize(unknownFields);
    }

    public SkillEffectHasteModifierDetail(
        SkillEffectAffectedSkillScope affectedSkillScope,
        SkillEffectModifierOperation operation
    ) {
        this(affectedSkillScope, operation, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillEffectHasteModifierDetail fromJson(
        @JsonProperty("affectedSkillScope") SkillEffectAffectedSkillScope affectedSkillScope,
        @JsonProperty("operation") SkillEffectModifierOperation operation,
        @JsonProperty("affectedSkillKeys") JsonNode affectedSkillKeys,
        @JsonProperty("modifierZoneKey") JsonNode modifierZoneKey,
        @JsonProperty("damageTypeKey") JsonNode damageTypeKey,
        @JsonProperty("attributeKey") JsonNode attributeKey,
        @JsonProperty("statusKey") JsonNode statusKey,
        @JsonProperty("targetEffectKey") JsonNode targetEffectKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillEffectHasteModifierDetail(
            affectedSkillScope,
            operation,
            SkillEffectDetailFieldCapture.captureForeign(
                "affectedSkillKeys", affectedSkillKeys,
                "modifierZoneKey", modifierZoneKey,
                "damageTypeKey", damageTypeKey,
                "attributeKey", attributeKey,
                "statusKey", statusKey,
                "targetEffectKey", targetEffectKey
            ),
            SkillEffectDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
