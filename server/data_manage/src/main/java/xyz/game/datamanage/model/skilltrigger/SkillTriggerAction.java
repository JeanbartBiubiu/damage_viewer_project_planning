package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.util.List;

@JsonDeserialize(using = SkillTriggerActionDeserializer.class)
public record SkillTriggerAction(
    @NotBlank(message = "动作标识不能为空")
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "动作标识格式不合法")
    String actionKey,
    @NotBlank(message = "动作名称不能为空")
    @Size(max = 100, message = "动作名称不能超过100个字符")
    String name,
    @NotNull(message = "动作种类不能为空")
    SkillTriggerActionType actionType,
    @NotNull(message = "排序不能为空")
    @PositiveOrZero(message = "排序不能小于0")
    @Max(value = 999999, message = "排序不能大于999999")
    Integer sortOrder,
    SkillTriggerTargetContext targetContext,
    @NotNull(message = "动作明细不能为空")
    @Valid
    SkillTriggerActionDetail detail,
    @NotNull(message = "动态输入绑定不能缺失")
    @Valid
    List<SkillTriggerRuntimeInputBinding> runtimeInputBindings,
    @NotNull(message = "结果修正不能缺失")
    @Valid
    List<SkillTriggerResultModifier> resultModifiers
) {
    public SkillTriggerAction {
        actionKey = actionKey == null ? null : actionKey.trim();
        name = name == null ? null : name.trim();
        runtimeInputBindings = runtimeInputBindings == null ? List.of() : List.copyOf(runtimeInputBindings);
        resultModifiers = resultModifiers == null ? List.of() : List.copyOf(resultModifiers);
    }
}
