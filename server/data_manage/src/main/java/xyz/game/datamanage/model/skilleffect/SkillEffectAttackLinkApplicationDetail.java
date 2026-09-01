package xyz.game.datamanage.model.skilleffect;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillEffectAttackLinkApplicationDetail(
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillEffectResultDetail {

    public SkillEffectAttackLinkApplicationDetail {
        foreignFields = SkillEffectDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillEffectDetailFieldCapture.normalize(unknownFields);
    }

    public SkillEffectAttackLinkApplicationDetail() {
        this(Set.of(), Set.of());
    }

    @JsonCreator
    static SkillEffectAttackLinkApplicationDetail fromJson(
        @JsonProperty("damageTypeKey") JsonNode damageTypeKey,
        @JsonProperty("attributeKey") JsonNode attributeKey,
        @JsonProperty("operation") JsonNode operation,
        @JsonProperty("affectedSkillKey") JsonNode affectedSkillKey,
        @JsonProperty("affectedSkillKeys") JsonNode affectedSkillKeys,
        @JsonProperty("statusKey") JsonNode statusKey,
        @JsonProperty("targetEffectKey") JsonNode targetEffectKey,
        @JsonProperty("modifierZoneKey") JsonNode modifierZoneKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillEffectAttackLinkApplicationDetail(
            SkillEffectDetailFieldCapture.captureForeign(
                "damageTypeKey", damageTypeKey,
                "attributeKey", attributeKey,
                "operation", operation,
                "affectedSkillKey", affectedSkillKey,
                "affectedSkillKeys", affectedSkillKeys,
                "statusKey", statusKey,
                "targetEffectKey", targetEffectKey,
                "modifierZoneKey", modifierZoneKey
            ),
            SkillEffectDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
