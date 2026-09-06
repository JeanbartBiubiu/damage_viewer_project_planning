package xyz.game.datamanage.model.skilleffect;

import java.math.BigDecimal;
import xyz.game.datamanage.model.value.SkillNumericValue;

public record SkillEffectValueRuleResponse(
    SkillNumericValue value,
    BigDecimal fixedMultiplier,
    BigDecimal fixedMinValue,
    BigDecimal fixedMaxValue
) {
}
