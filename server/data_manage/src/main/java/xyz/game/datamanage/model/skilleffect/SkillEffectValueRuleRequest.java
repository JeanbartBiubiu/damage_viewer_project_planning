package xyz.game.datamanage.model.skilleffect;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import xyz.game.datamanage.model.value.SkillNumericValue;

public record SkillEffectValueRuleRequest(
    @NotNull(message = "数值取值不能为空")
    @Valid
    SkillNumericValue value,
    @NotNull(message = "固定倍率不能为空")
    @DecimalMin(value = "0", inclusive = true, message = "固定倍率不能小于0")
    BigDecimal fixedMultiplier,
    BigDecimal fixedMinValue,
    BigDecimal fixedMaxValue
) {
    @JsonAnySetter
    public void rejectUnknownField(String fieldName, Object ignored) {
        throw new IllegalArgumentException("未知字段：" + fieldName);
    }
}
