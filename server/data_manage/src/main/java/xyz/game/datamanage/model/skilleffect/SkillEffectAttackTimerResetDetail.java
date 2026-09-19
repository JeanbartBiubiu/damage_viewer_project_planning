package xyz.game.datamanage.model.skilleffect;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillEffectAttackTimerResetDetail(
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillEffectResultDetail {

    public SkillEffectAttackTimerResetDetail {
        foreignFields = SkillEffectDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillEffectDetailFieldCapture.normalize(unknownFields);
    }

    public SkillEffectAttackTimerResetDetail() {
        this(Set.of(), Set.of());
    }

    @JsonCreator
    static SkillEffectAttackTimerResetDetail fromJson(@JsonAnySetter Map<String, JsonNode> unknown) {
        return new SkillEffectAttackTimerResetDetail(
            Set.of(), SkillEffectDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
