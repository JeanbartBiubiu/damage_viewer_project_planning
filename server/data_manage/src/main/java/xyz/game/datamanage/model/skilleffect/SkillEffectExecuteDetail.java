package xyz.game.datamanage.model.skilleffect;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillEffectExecuteDetail(
    String attributeKey,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillEffectResultDetail {

    public SkillEffectExecuteDetail {
        attributeKey = attributeKey == null ? null : attributeKey.trim();
        foreignFields = SkillEffectDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillEffectDetailFieldCapture.normalize(unknownFields);
    }

    public SkillEffectExecuteDetail(String attributeKey) {
        this(attributeKey, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillEffectExecuteDetail fromJson(
        @JsonProperty("attributeKey") String attributeKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillEffectExecuteDetail(
            attributeKey,
            Set.of(),
            SkillEffectDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
