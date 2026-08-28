package xyz.game.datamanage.model.skilleffect;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

public record SkillEffectValueRuleRequest(
    @NotBlank(message = "公式标识不能为空")
    String formulaKey,
    @NotNull(message = "固定倍率不能为空")
    @DecimalMin(value = "0", inclusive = true, message = "固定倍率不能小于0")
    BigDecimal fixedMultiplier,
    BigDecimal fixedMinValue,
    BigDecimal fixedMaxValue
) {
    public SkillEffectValueRuleRequest {
        formulaKey = formulaKey == null ? null : formulaKey.trim();
    }
}
