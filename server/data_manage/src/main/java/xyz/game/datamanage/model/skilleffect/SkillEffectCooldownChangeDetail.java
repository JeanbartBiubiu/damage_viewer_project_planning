package xyz.game.datamanage.model.skilleffect;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillEffectCooldownChangeDetail(
    String affectedSkillKey,
    SkillEffectCooldownChangeOperation operation,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillEffectResultDetail {

    public SkillEffectCooldownChangeDetail {
        affectedSkillKey = affectedSkillKey == null ? null : affectedSkillKey.trim();
        foreignFields = SkillEffectDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillEffectDetailFieldCapture.normalize(unknownFields);
    }

    public SkillEffectCooldownChangeDetail(
        String affectedSkillKey,
        SkillEffectCooldownChangeOperation operation
    ) {
        this(affectedSkillKey, operation, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillEffectCooldownChangeDetail fromJson(
        @JsonProperty("affectedSkillKey") String affectedSkillKey,
        @JsonProperty("operation") SkillEffectCooldownChangeOperation operation,
        @JsonProperty("damageTypeKey") JsonNode damageTypeKey,
        @JsonProperty("attributeKey") JsonNode attributeKey,
        @JsonProperty("statusKey") JsonNode statusKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillEffectCooldownChangeDetail(
            affectedSkillKey,
            operation,
            SkillEffectDetailFieldCapture.captureForeign(
                "damageTypeKey", damageTypeKey,
                "attributeKey", attributeKey,
                "statusKey", statusKey
            ),
            SkillEffectDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
