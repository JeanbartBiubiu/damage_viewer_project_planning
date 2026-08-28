package xyz.game.datamanage.model.skilleffect;

import java.math.BigDecimal;

public record SkillEffectResultValueRow(
    String gameId,
    String skillKey,
    String effectKey,
    String resultKey,
    String formulaKey,
    BigDecimal fixedMultiplier,
    BigDecimal fixedMinValue,
    BigDecimal fixedMaxValue
) {
}
