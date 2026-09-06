package xyz.game.datamanage.model.skilleffect;

import java.math.BigDecimal;
import xyz.game.datamanage.model.value.SkillNumericValue;

public record SkillEffectResultValueRow(
    String gameId,
    String skillKey,
    String effectKey,
    String resultKey,
    SkillNumericValue value,
    BigDecimal fixedMultiplier,
    BigDecimal fixedMinValue,
    BigDecimal fixedMaxValue
) {
}
