package xyz.game.datamanage.model.skilleffect;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillEffectLifecycleOperationDetail(
    String targetEffectKey,
    SkillEffectLifecycleOperation operation,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillEffectResultDetail {

    public SkillEffectLifecycleOperationDetail {
        targetEffectKey = targetEffectKey == null ? null : targetEffectKey.trim();
        foreignFields = SkillEffectDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillEffectDetailFieldCapture.normalize(unknownFields);
    }

    public SkillEffectLifecycleOperationDetail(
        String targetEffectKey,
        SkillEffectLifecycleOperation operation
    ) {
        this(targetEffectKey, operation, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillEffectLifecycleOperationDetail fromJson(
        @JsonProperty("targetEffectKey") String targetEffectKey,
        @JsonProperty("operation") SkillEffectLifecycleOperation operation,
        @JsonProperty("damageTypeKey") JsonNode damageTypeKey,
        @JsonProperty("attributeKey") JsonNode attributeKey,
        @JsonProperty("affectedSkillKey") JsonNode affectedSkillKey,
        @JsonProperty("statusKey") JsonNode statusKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillEffectLifecycleOperationDetail(
            targetEffectKey,
            operation,
            SkillEffectDetailFieldCapture.captureForeign(
                "damageTypeKey", damageTypeKey,
                "attributeKey", attributeKey,
                "affectedSkillKey", affectedSkillKey,
                "statusKey", statusKey
            ),
            SkillEffectDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
