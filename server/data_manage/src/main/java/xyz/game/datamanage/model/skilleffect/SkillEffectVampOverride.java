package xyz.game.datamanage.model.skilleffect;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.Valid;
import xyz.game.datamanage.model.value.SkillNumericValue;

/** 伤害仅保存已核定的禁止或覆盖；普通行为继承游戏规则。 */
public record SkillEffectVampOverride(
    SkillEffectVampType vampType,
    SkillEffectVampOverrideMode mode,
    SkillEffectVampBasisOutputKind basisOutputKind,
    @Valid SkillNumericValue efficiencyValue
) {
    @JsonAnySetter
    public void rejectUnknownField(String fieldName, Object ignored) {
        throw new IllegalArgumentException("未知字段：" + fieldName);
    }
}
