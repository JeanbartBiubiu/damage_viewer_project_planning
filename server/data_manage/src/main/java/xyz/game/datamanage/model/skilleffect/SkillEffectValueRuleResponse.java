package xyz.game.datamanage.model.skilleffect;

import java.math.BigDecimal;

public record SkillEffectValueRuleResponse(
    String formulaKey,
    BigDecimal fixedMultiplier,
    BigDecimal fixedMinValue,
    BigDecimal fixedMaxValue
) {
}
