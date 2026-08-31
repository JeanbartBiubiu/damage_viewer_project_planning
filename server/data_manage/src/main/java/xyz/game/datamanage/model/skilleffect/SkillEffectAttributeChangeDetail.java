package xyz.game.datamanage.model.skilleffect;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillEffectAttributeChangeDetail(
    String attributeKey,
    SkillEffectAttributeChangeOperation operation,
    String modifierZoneKey,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillEffectResultDetail {

    public SkillEffectAttributeChangeDetail {
        attributeKey = attributeKey == null ? null : attributeKey.trim();
        modifierZoneKey = modifierZoneKey == null ? null : modifierZoneKey.trim();
        foreignFields = SkillEffectDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillEffectDetailFieldCapture.normalize(unknownFields);
    }

    public SkillEffectAttributeChangeDetail(
        String attributeKey,
        SkillEffectAttributeChangeOperation operation
    ) {
        this(attributeKey, operation, null, Set.of(), Set.of());
    }

    public SkillEffectAttributeChangeDetail(
        String attributeKey,
        SkillEffectAttributeChangeOperation operation,
        String modifierZoneKey
    ) {
        this(attributeKey, operation, modifierZoneKey, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillEffectAttributeChangeDetail fromJson(
        @JsonProperty("attributeKey") String attributeKey,
        @JsonProperty("operation") SkillEffectAttributeChangeOperation operation,
        @JsonProperty("modifierZoneKey") String modifierZoneKey,
        @JsonProperty("damageTypeKey") JsonNode damageTypeKey,
        @JsonProperty("affectedSkillKey") JsonNode affectedSkillKey,
        @JsonProperty("statusKey") JsonNode statusKey,
        @JsonProperty("targetEffectKey") JsonNode targetEffectKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillEffectAttributeChangeDetail(
            attributeKey,
            operation,
            modifierZoneKey,
            SkillEffectDetailFieldCapture.captureForeign(
                "damageTypeKey", damageTypeKey,
                "affectedSkillKey", affectedSkillKey,
                "statusKey", statusKey,
                "targetEffectKey", targetEffectKey
            ),
            SkillEffectDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
