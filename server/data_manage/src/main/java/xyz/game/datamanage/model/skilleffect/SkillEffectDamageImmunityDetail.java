package xyz.game.datamanage.model.skilleffect;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillEffectDamageImmunityDetail(
    String damageTypeKey,
    SkillEffectDamageFilterDeliveryKind deliveryKind,
    SkillEffectDamageFilterOriginKind originKind,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillEffectResultDetail {

    public SkillEffectDamageImmunityDetail {
        damageTypeKey = damageTypeKey == null ? null : damageTypeKey.trim();
        foreignFields = SkillEffectDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillEffectDetailFieldCapture.normalize(unknownFields);
    }

    public SkillEffectDamageImmunityDetail(
        String damageTypeKey,
        SkillEffectDamageFilterDeliveryKind deliveryKind,
        SkillEffectDamageFilterOriginKind originKind
    ) {
        this(damageTypeKey, deliveryKind, originKind, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillEffectDamageImmunityDetail fromJson(
        @JsonProperty("damageTypeKey") String damageTypeKey,
        @JsonProperty("deliveryKind") SkillEffectDamageFilterDeliveryKind deliveryKind,
        @JsonProperty("originKind") SkillEffectDamageFilterOriginKind originKind,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillEffectDamageImmunityDetail(
            damageTypeKey,
            deliveryKind,
            originKind,
            Set.of(),
            SkillEffectDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
