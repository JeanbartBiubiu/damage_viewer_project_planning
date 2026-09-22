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

public record SkillTriggerRuleCreateRequest(
    @NotBlank(message = "规则标识不能为空")
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "规则标识格式不合法")
    String ruleKey,
    @NotBlank(message = "规则名称不能为空")
    @Size(max = 100, message = "规则名称不能超过100个字符")
    String name,
    @Size(max = 1000, message = "说明不能超过1000个字符")
    String description,
    @NotNull(message = "排序不能为空")
    @PositiveOrZero(message = "排序不能小于0")
    @Max(value = 999999, message = "排序不能大于999999")
    Integer sortOrder,
    @NotNull(message = "事件来源不能为空")
    @Valid
    SkillTriggerEventSource eventSource,
    @NotNull(message = "条件组不能缺失")
    @Valid
    List<SkillTriggerConditionGroup> conditionGroups,
    @NotNull(message = "动作列表不能缺失")
    @NotEmpty(message = "规则至少包含一个动作")
    @Valid
    List<SkillTriggerAction> actions,
    @Valid
    SkillTriggerPerTargetCooldown perTargetCooldown,
    @Valid
    SkillTriggerProcessLimit maxTriggersPerProcess,
    @Valid
    SkillTriggerOncePerUse oncePerUse
) {
    public SkillTriggerRuleCreateRequest {
        ruleKey = ruleKey == null ? null : ruleKey.trim();
        name = name == null ? null : name.trim();
        if (description != null) {
            description = description.trim();
            description = description.isEmpty() ? null : description;
        }
        conditionGroups = conditionGroups == null ? List.of() : List.copyOf(conditionGroups);
    }
}
