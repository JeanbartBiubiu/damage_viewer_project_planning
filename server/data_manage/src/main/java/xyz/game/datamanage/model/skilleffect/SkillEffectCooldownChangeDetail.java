package xyz.game.datamanage.model.skilleffect;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;

public record SkillEffectCooldownChangeDetail(
    List<String> affectedSkillKeys,
    SkillEffectCooldownChangeOperation operation,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillEffectResultDetail {

    public SkillEffectCooldownChangeDetail {
        if (affectedSkillKeys != null) {
            List<String> normalized = new ArrayList<>(affectedSkillKeys.size());
            for (String affectedSkillKey : affectedSkillKeys) {
                normalized.add(affectedSkillKey == null ? null : affectedSkillKey.trim());
            }
            affectedSkillKeys = Collections.unmodifiableList(normalized);
        }
        foreignFields = SkillEffectDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillEffectDetailFieldCapture.normalize(unknownFields);
    }

    public SkillEffectCooldownChangeDetail(
        List<String> affectedSkillKeys,
        SkillEffectCooldownChangeOperation operation
    ) {
        this(affectedSkillKeys, operation, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillEffectCooldownChangeDetail fromJson(
        @JsonProperty("affectedSkillKeys") List<String> affectedSkillKeys,
        @JsonProperty("operation") SkillEffectCooldownChangeOperation operation,
        @JsonProperty("damageTypeKey") JsonNode damageTypeKey,
        @JsonProperty("attributeKey") JsonNode attributeKey,
        @JsonProperty("statusKey") JsonNode statusKey,
        @JsonProperty("targetEffectKey") JsonNode targetEffectKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillEffectCooldownChangeDetail(
            affectedSkillKeys,
            operation,
            SkillEffectDetailFieldCapture.captureForeign(
                "damageTypeKey", damageTypeKey,
                "attributeKey", attributeKey,
                "statusKey", statusKey,
                "targetEffectKey", targetEffectKey
            ),
            SkillEffectDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
