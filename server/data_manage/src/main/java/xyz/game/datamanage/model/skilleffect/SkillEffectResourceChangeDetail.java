package xyz.game.datamanage.model.skilleffect;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillEffectResourceChangeDetail(
    String attributeKey,
    SkillEffectResourceChangeOperation operation,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillEffectResultDetail {

    public SkillEffectResourceChangeDetail {
        attributeKey = attributeKey == null ? null : attributeKey.trim();
        foreignFields = SkillEffectDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillEffectDetailFieldCapture.normalize(unknownFields);
    }

    public SkillEffectResourceChangeDetail(
        String attributeKey,
        SkillEffectResourceChangeOperation operation
    ) {
        this(attributeKey, operation, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillEffectResourceChangeDetail fromJson(
        @JsonProperty("attributeKey") String attributeKey,
        @JsonProperty("operation") SkillEffectResourceChangeOperation operation,
        @JsonProperty("damageTypeKey") JsonNode damageTypeKey,
        @JsonProperty("affectedSkillKey") JsonNode affectedSkillKey,
        @JsonProperty("statusKey") JsonNode statusKey,
        @JsonProperty("targetEffectKey") JsonNode targetEffectKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillEffectResourceChangeDetail(
            attributeKey,
            operation,
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
