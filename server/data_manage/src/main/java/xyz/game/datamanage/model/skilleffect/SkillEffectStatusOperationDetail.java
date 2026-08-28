package xyz.game.datamanage.model.skilleffect;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillEffectStatusOperationDetail(
    String statusKey,
    SkillEffectStatusOperation operation,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillEffectResultDetail {

    public SkillEffectStatusOperationDetail {
        statusKey = statusKey == null ? null : statusKey.trim();
        foreignFields = SkillEffectDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillEffectDetailFieldCapture.normalize(unknownFields);
    }

    public SkillEffectStatusOperationDetail(String statusKey, SkillEffectStatusOperation operation) {
        this(statusKey, operation, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillEffectStatusOperationDetail fromJson(
        @JsonProperty("statusKey") String statusKey,
        @JsonProperty("operation") SkillEffectStatusOperation operation,
        @JsonProperty("damageTypeKey") JsonNode damageTypeKey,
        @JsonProperty("attributeKey") JsonNode attributeKey,
        @JsonProperty("affectedSkillKey") JsonNode affectedSkillKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillEffectStatusOperationDetail(
            statusKey,
            operation,
            SkillEffectDetailFieldCapture.captureForeign(
                "damageTypeKey", damageTypeKey,
                "attributeKey", attributeKey,
                "affectedSkillKey", affectedSkillKey
            ),
            SkillEffectDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
