package xyz.game.datamanage.model.skilleffect;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillEffectNormalShieldDetail(
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillEffectResultDetail {

    public SkillEffectNormalShieldDetail {
        foreignFields = SkillEffectDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillEffectDetailFieldCapture.normalize(unknownFields);
    }

    public SkillEffectNormalShieldDetail() {
        this(Set.of(), Set.of());
    }

    @JsonCreator
    static SkillEffectNormalShieldDetail fromJson(
        @JsonProperty("damageTypeKey") JsonNode damageTypeKey,
        @JsonProperty("attributeKey") JsonNode attributeKey,
        @JsonProperty("operation") JsonNode operation,
        @JsonProperty("affectedSkillKey") JsonNode affectedSkillKey,
        @JsonProperty("statusKey") JsonNode statusKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillEffectNormalShieldDetail(
            SkillEffectDetailFieldCapture.captureForeign(
                "damageTypeKey", damageTypeKey,
                "attributeKey", attributeKey,
                "operation", operation,
                "affectedSkillKey", affectedSkillKey,
                "statusKey", statusKey
            ),
            SkillEffectDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
