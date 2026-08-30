package xyz.game.datamanage.model.skilltrigger;

import java.math.BigDecimal;

public record SkillTriggerResultModifierRow(
    String gameId,
    String skillKey,
    String ruleKey,
    String actionKey,
    String resultKey,
    String effectKey,
    BigDecimal fixedMultiplier,
    BigDecimal fixedMinValue,
    BigDecimal fixedMaxValue
) {
}
