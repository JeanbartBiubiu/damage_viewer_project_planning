package xyz.game.datamanage.model.skilleffect;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillEffectHealingModifierDetail(
    String modifierZoneKey,
    SkillEffectHealingModifierDirection direction,
    SkillEffectModifierOperation operation,
    SkillEffectHealingKind healingKind,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillEffectResultDetail {

    public SkillEffectHealingModifierDetail {
        modifierZoneKey = modifierZoneKey == null ? null : modifierZoneKey.trim();
        foreignFields = SkillEffectDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillEffectDetailFieldCapture.normalize(unknownFields);
    }

    public SkillEffectHealingModifierDetail(
        SkillEffectHealingModifierDirection direction,
        SkillEffectModifierOperation operation,
        SkillEffectHealingKind healingKind
    ) {
        this(null, direction, operation, healingKind, Set.of(), Set.of());
    }

    public SkillEffectHealingModifierDetail(
        String modifierZoneKey,
        SkillEffectHealingModifierDirection direction,
        SkillEffectModifierOperation operation,
        SkillEffectHealingKind healingKind
    ) {
        this(modifierZoneKey, direction, operation, healingKind, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillEffectHealingModifierDetail fromJson(
        @JsonProperty("modifierZoneKey") String modifierZoneKey,
        @JsonProperty("direction") SkillEffectHealingModifierDirection direction,
        @JsonProperty("operation") SkillEffectModifierOperation operation,
        @JsonProperty("healingKind") SkillEffectHealingKind healingKind,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillEffectHealingModifierDetail(
            modifierZoneKey,
            direction,
            operation,
            healingKind,
            Set.of(),
            SkillEffectDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
