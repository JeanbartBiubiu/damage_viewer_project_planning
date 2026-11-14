package xyz.game.datamanage.model.skilleffect;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillEffectCooldownChangeDetail(
    SkillEffectAffectedSkillScope affectedSkillScope,
    SkillEffectCooldownChangeOperation operation,
    @JsonInclude(JsonInclude.Include.NON_NULL) JsonNode cumulativeLimit,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillEffectResultDetail {

    public SkillEffectCooldownChangeDetail {
        foreignFields = SkillEffectDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillEffectDetailFieldCapture.normalize(unknownFields);
    }

    public SkillEffectCooldownChangeDetail(
        SkillEffectAffectedSkillScope affectedSkillScope,
        SkillEffectCooldownChangeOperation operation
    ) {
        this(affectedSkillScope, operation, null, Set.of(), Set.of());
    }

    public SkillEffectCooldownChangeDetail(
        SkillEffectAffectedSkillScope affectedSkillScope,
        SkillEffectCooldownChangeOperation operation,
        JsonNode cumulativeLimit
    ) {
        this(affectedSkillScope, operation, cumulativeLimit, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillEffectCooldownChangeDetail fromJson(
        @JsonProperty("affectedSkillScope") SkillEffectAffectedSkillScope affectedSkillScope,
        @JsonProperty("operation") SkillEffectCooldownChangeOperation operation,
        @JsonProperty("cumulativeLimit") JsonNode cumulativeLimit,
        @JsonProperty("affectedSkillKeys") JsonNode affectedSkillKeys,
        @JsonProperty("damageTypeKey") JsonNode damageTypeKey,
        @JsonProperty("attributeKey") JsonNode attributeKey,
        @JsonProperty("statusKey") JsonNode statusKey,
        @JsonProperty("targetEffectKey") JsonNode targetEffectKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillEffectCooldownChangeDetail(
            affectedSkillScope,
            operation,
            cumulativeLimit,
            SkillEffectDetailFieldCapture.captureForeign(
                "affectedSkillKeys", affectedSkillKeys,
                "damageTypeKey", damageTypeKey,
                "attributeKey", attributeKey,
                "statusKey", statusKey,
                "targetEffectKey", targetEffectKey
            ),
            SkillEffectDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
