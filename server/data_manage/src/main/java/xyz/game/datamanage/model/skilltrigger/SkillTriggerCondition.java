package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;

@JsonDeserialize(using = SkillTriggerConditionDeserializer.class)
public record SkillTriggerCondition(
    @NotBlank(message = "条件标识不能为空")
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "条件标识格式不合法")
    String conditionKey,
    @NotNull(message = "条件种类不能为空")
    SkillTriggerConditionType conditionType,
    @NotNull(message = "排序不能为空")
    @PositiveOrZero(message = "排序不能小于0")
    @Max(value = 999999, message = "排序不能大于999999")
    Integer sortOrder,
    @NotNull(message = "条件明细不能为空")
    @Valid
    SkillTriggerConditionDetail detail
) {
    public SkillTriggerCondition {
        conditionKey = conditionKey == null ? null : conditionKey.trim();
    }
}
