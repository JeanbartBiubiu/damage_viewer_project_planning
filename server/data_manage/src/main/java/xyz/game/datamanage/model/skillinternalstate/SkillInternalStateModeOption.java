package xyz.game.datamanage.model.skillinternalstate;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

public record SkillInternalStateModeOption(
    @NotBlank(message = "模式选项标识不能为空")
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "模式选项标识格式不合法")
    String optionKey,
    @NotBlank(message = "模式选项名称不能为空")
    @Size(max = 100, message = "模式选项名称不能超过100个字符")
    String name,
    @NotNull(message = "排序不能为空")
    @PositiveOrZero(message = "排序不能小于0")
    Integer sortOrder,
    @NotNull(message = "初始选项不能为空")
    Boolean initial
) {
    public SkillInternalStateModeOption {
        optionKey = optionKey == null ? null : optionKey.trim();
        name = name == null ? null : name.trim();
    }
}
