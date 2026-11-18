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
    @JsonInclude(JsonInclude.Include.NON_NULL)
    SkillEffectSpellShieldFollowResult spellShieldFollowResult,
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
        this(damageTypeKey, deliveryKind, originKind, critical, vampQualification, vampOverrides, null, null, Set.of(), Set.of());
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
            attackDamageRole, null, Set.of(), Set.of());
    }

    public SkillEffectDamageDetail(
        String damageTypeKey, SkillEffectDamageDeliveryKind deliveryKind, SkillEffectDamageOriginKind originKind,
        SkillEffectCriticalPolicy critical, SkillEffectVampQualification vampQualification,
        List<SkillEffectVampOverride> vampOverrides, SkillEffectAttackDamageRole attackDamageRole,
        SkillEffectSpellShieldFollowResult spellShieldFollowResult
    ) {
        this(damageTypeKey, deliveryKind, originKind, critical, vampQualification, vampOverrides,
            attackDamageRole, spellShieldFollowResult, Set.of(), Set.of());
    }

    public SkillEffectDamageDetail(
        String damageTypeKey, SkillEffectDamageDeliveryKind deliveryKind, SkillEffectDamageOriginKind originKind,
        SkillEffectCriticalPolicy critical, SkillEffectVampQualification vampQualification,
        List<SkillEffectVampOverride> vampOverrides, SkillEffectAttackDamageRole attackDamageRole,
        Set<String> foreignFields, Set<String> unknownFields
    ) {
        this(damageTypeKey, deliveryKind, originKind, critical, vampQualification, vampOverrides,
            attackDamageRole, null, foreignFields, unknownFields);
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
            null, null, foreignFields, unknownFields);
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
        @JsonProperty("spellShieldFollowResult") JsonNode spellShieldFollowResult,
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
            readSpellShieldFollowResult(spellShieldFollowResult),
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

    private static SkillEffectSpellShieldFollowResult readSpellShieldFollowResult(JsonNode value) {
        if (value == null) return null;
        Set<String> fields = Set.of("skillKey", "effectKey", "resultKey");
        if (!value.isObject() || value.size() != fields.size())
            throw new IllegalArgumentException("spellShieldFollowResult 必须明确技能、效果与结果，不能为null或带额外字段");
        for (String field : fields) {
            JsonNode key = value.get(field);
            if (key == null || !key.isTextual() || !key.textValue().matches("^[a-z][a-z0-9_]{0,63}$"))
                throw new IllegalArgumentException("spellShieldFollowResult 标识必须是合法的明确字符串");
        }
        return new SkillEffectSpellShieldFollowResult(value.get("skillKey").textValue(),
            value.get("effectKey").textValue(), value.get("resultKey").textValue());
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
