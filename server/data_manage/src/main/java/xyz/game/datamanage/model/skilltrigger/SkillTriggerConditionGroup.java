package xyz.game.datamanage.model.skilltrigger;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.util.List;

public record SkillTriggerConditionGroup(
    @NotBlank(message = "条件组标识不能为空")
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "条件组标识格式不合法")
    String groupKey,
    @NotBlank(message = "条件组名称不能为空")
    @Size(max = 100, message = "条件组名称不能超过100个字符")
    String name,
    @NotNull(message = "排序不能为空")
    @PositiveOrZero(message = "排序不能小于0")
    @Max(value = 999999, message = "排序不能大于999999")
    Integer sortOrder,
    @NotNull(message = "条件列表不能缺失")
    @NotEmpty(message = "条件组至少包含一个条件")
    @Valid
    List<SkillTriggerCondition> conditions
) {
    public SkillTriggerConditionGroup {
        groupKey = groupKey == null ? null : groupKey.trim();
        name = name == null ? null : name.trim();
    }
}
