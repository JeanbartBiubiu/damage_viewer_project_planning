package xyz.game.datamanage.model.skilleffect;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillEffectNormalShieldDetail(
    String absorbedDamageTypeKey,
    SkillEffectNormalShieldDecayMode decayMode,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillEffectResultDetail {

    public SkillEffectNormalShieldDetail {
        absorbedDamageTypeKey = absorbedDamageTypeKey == null ? null : absorbedDamageTypeKey.trim();
        foreignFields = SkillEffectDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillEffectDetailFieldCapture.normalize(unknownFields);
    }

    public SkillEffectNormalShieldDetail() {
        this(null, SkillEffectNormalShieldDecayMode.NONE, Set.of(), Set.of());
    }

    public SkillEffectNormalShieldDetail(
        String absorbedDamageTypeKey,
        SkillEffectNormalShieldDecayMode decayMode
    ) {
        this(absorbedDamageTypeKey, decayMode, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillEffectNormalShieldDetail fromJson(
        @JsonProperty("absorbedDamageTypeKey") String absorbedDamageTypeKey,
        @JsonProperty("decayMode") SkillEffectNormalShieldDecayMode decayMode,
        @JsonProperty("damageTypeKey") JsonNode damageTypeKey,
        @JsonProperty("deliveryKind") JsonNode deliveryKind,
        @JsonProperty("originKind") JsonNode originKind,
        @JsonProperty("critical") JsonNode critical,
        @JsonProperty("vampQualification") JsonNode vampQualification,
        @JsonProperty("vampOverrides") JsonNode vampOverrides,
        @JsonProperty("attributeKey") JsonNode attributeKey,
        @JsonProperty("operation") JsonNode operation,
        @JsonProperty("affectedSkillKey") JsonNode affectedSkillKey,
        @JsonProperty("affectedSkillKeys") JsonNode affectedSkillKeys,
        @JsonProperty("statusKey") JsonNode statusKey,
        @JsonProperty("targetEffectKey") JsonNode targetEffectKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillEffectNormalShieldDetail(
            absorbedDamageTypeKey,
            decayMode,
            SkillEffectDetailFieldCapture.captureForeign(
                "damageTypeKey", damageTypeKey,
                "deliveryKind", deliveryKind,
                "originKind", originKind,
                "critical", critical,
                "vampQualification", vampQualification,
                "vampOverrides", vampOverrides,
                "attributeKey", attributeKey,
                "operation", operation,
                "affectedSkillKey", affectedSkillKey,
                "affectedSkillKeys", affectedSkillKeys,
                "statusKey", statusKey,
                "targetEffectKey", targetEffectKey
            ),
            SkillEffectDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
