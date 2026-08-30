package xyz.game.datamanage.model.skilltrigger;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import java.math.BigDecimal;

public record SkillTriggerResultModifier(
    @NotBlank(message = "结果标识不能为空")
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "结果标识格式不合法")
    String resultKey,
    @DecimalMin(value = "0", message = "固定倍率不能小于0")
    BigDecimal fixedMultiplier,
    BigDecimal fixedMinValue,
    BigDecimal fixedMaxValue
) {
    public SkillTriggerResultModifier {
        resultKey = resultKey == null ? null : resultKey.trim();
    }
}
