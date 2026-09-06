package xyz.game.datamanage.model.skilleffect;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.Valid;
import xyz.game.datamanage.model.value.SkillNumericValue;

/**
 * 暂存的技能侧吸血结构。
 * 后续应由来源对象的吸血属性和游戏级结算规则提供默认行为，技能侧只表达必要例外；
 * 在该规则冻结前保留现有聚合接口和数据库结构，避免丢失已录入数据。
 */
public record SkillEffectVampRule(
    SkillEffectVampType vampType,
    SkillEffectVampBasisOutputKind basisOutputKind,
    @Valid
    SkillNumericValue efficiencyValue
) {
    @JsonAnySetter
    public void rejectUnknownField(String fieldName, Object ignored) {
        throw new IllegalArgumentException("未知字段：" + fieldName);
    }
}
