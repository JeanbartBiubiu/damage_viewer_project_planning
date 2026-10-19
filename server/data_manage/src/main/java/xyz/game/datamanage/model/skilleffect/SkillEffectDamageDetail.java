package xyz.game.datamanage.model.skilleffect;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;

public record SkillEffectDamageDetail(
    String damageTypeKey,
    SkillEffectDamageDeliveryKind deliveryKind,
    SkillEffectDamageOriginKind originKind,
    SkillEffectCriticalPolicy critical,
    SkillEffectVampQualification vampQualification,
    List<SkillEffectVampOverride> vampOverrides,
    @JsonInclude(JsonInclude.Include.NON_NULL)
    SkillEffectAttackDamageRole attackDamageRole,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillEffectResultDetail {

    public SkillEffectDamageDetail {
        damageTypeKey = damageTypeKey == null ? null : damageTypeKey.trim();
        vampOverrides = vampOverrides == null
            ? null
            : Collections.unmodifiableList(new ArrayList<>(vampOverrides));
        foreignFields = SkillEffectDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillEffectDetailFieldCapture.normalize(unknownFields);
    }

    public SkillEffectDamageDetail(String damageTypeKey) {
        this(
            damageTypeKey,
            SkillEffectDamageDeliveryKind.SKILL,
            SkillEffectDamageOriginKind.DIRECT,
            new SkillEffectCriticalPolicy(SkillEffectCriticalMode.DISALLOWED, null),
            SkillEffectVampQualification.UNRESOLVED,
            List.of(),
            null,
            Set.of(),
            Set.of()
        );
    }

    public SkillEffectDamageDetail(
        String damageTypeKey,
        SkillEffectDamageDeliveryKind deliveryKind,
        SkillEffectDamageOriginKind originKind,
        SkillEffectCriticalPolicy critical,
        SkillEffectVampQualification vampQualification,
        List<SkillEffectVampOverride> vampOverrides
    ) {
        this(damageTypeKey, deliveryKind, originKind, critical, vampQualification, vampOverrides, null, Set.of(), Set.of());
    }

    public SkillEffectDamageDetail(
        String damageTypeKey,
        SkillEffectDamageDeliveryKind deliveryKind,
        SkillEffectDamageOriginKind originKind,
        SkillEffectCriticalPolicy critical,
        SkillEffectVampQualification vampQualification,
        List<SkillEffectVampOverride> vampOverrides,
        SkillEffectAttackDamageRole attackDamageRole
    ) {
        this(damageTypeKey, deliveryKind, originKind, critical, vampQualification, vampOverrides,
            attackDamageRole, Set.of(), Set.of());
    }

    public SkillEffectDamageDetail(
        String damageTypeKey,
        SkillEffectDamageDeliveryKind deliveryKind,
        SkillEffectDamageOriginKind originKind,
        SkillEffectCriticalPolicy critical,
        SkillEffectVampQualification vampQualification,
        List<SkillEffectVampOverride> vampOverrides,
        Set<String> foreignFields,
        Set<String> unknownFields
    ) {
        this(damageTypeKey, deliveryKind, originKind, critical, vampQualification, vampOverrides,
            null, foreignFields, unknownFields);
    }

    @JsonCreator
    static SkillEffectDamageDetail fromJson(
        @JsonProperty("damageTypeKey") String damageTypeKey,
        @JsonProperty("deliveryKind") SkillEffectDamageDeliveryKind deliveryKind,
        @JsonProperty("originKind") SkillEffectDamageOriginKind originKind,
        @JsonProperty("critical") SkillEffectCriticalPolicy critical,
        @JsonProperty("vampQualification") SkillEffectVampQualification vampQualification,
        @JsonProperty("vampOverrides") List<SkillEffectVampOverride> vampOverrides,
        @JsonProperty("attackDamageRole") JsonNode attackDamageRole,
        @JsonProperty("attributeKey") JsonNode attributeKey,
        @JsonProperty("operation") JsonNode operation,
        @JsonProperty("affectedSkillKey") JsonNode affectedSkillKey,
        @JsonProperty("affectedSkillKeys") JsonNode affectedSkillKeys,
        @JsonProperty("statusKey") JsonNode statusKey,
        @JsonProperty("targetEffectKey") JsonNode targetEffectKey,
        @JsonProperty("absorbedDamageTypeKey") JsonNode absorbedDamageTypeKey,
        @JsonProperty("decayMode") JsonNode decayMode,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillEffectDamageDetail(
            damageTypeKey,
            deliveryKind,
            originKind,
            critical,
            vampQualification,
            vampOverrides,
            readAttackDamageRole(attackDamageRole),
            SkillEffectDetailFieldCapture.captureForeign(
                "attributeKey", attributeKey,
                "operation", operation,
                "affectedSkillKey", affectedSkillKey,
                "affectedSkillKeys", affectedSkillKeys,
                "statusKey", statusKey,
                "targetEffectKey", targetEffectKey,
                "absorbedDamageTypeKey", absorbedDamageTypeKey,
                "decayMode", decayMode
            ),
            SkillEffectDetailFieldCapture.captureUnknown(unknown)
        );
    }

    private static SkillEffectAttackDamageRole readAttackDamageRole(JsonNode value) {
        if (value == null) return null;
        if (!value.isTextual()) {
            throw new IllegalArgumentException("attackDamageRole 必须是明确的字符串，不能为 null");
        }
        try {
            return SkillEffectAttackDamageRole.valueOf(value.textValue());
        } catch (IllegalArgumentException invalid) {
            throw new IllegalArgumentException("attackDamageRole 只接受 PRIMARY 或 REPLACE_PRIMARY", invalid);
        }
    }
}
