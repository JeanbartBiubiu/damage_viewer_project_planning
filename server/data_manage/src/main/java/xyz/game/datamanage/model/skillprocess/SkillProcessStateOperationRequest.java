package xyz.game.datamanage.model.skillprocess;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

public record SkillProcessStateOperationRequest(
    @NotBlank(message = "内部状态操作标识不能为空")
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "内部状态操作标识格式不合法")
    String operationKey,
    @NotBlank(message = "内部状态操作名称不能为空")
    @Size(max = 100, message = "内部状态操作名称不能超过100个字符")
    String name,
    @NotBlank(message = "内部状态标识不能为空")
    String stateKey,
    @NotNull(message = "内部状态操作种类不能为空")
    SkillProcessStateOperationKind operation,
    String valueFormulaKey,
    String optionKey,
    @NotNull(message = "过程时点不能为空")
    @Valid
    SkillProcessMoment moment,
    @NotNull(message = "排序不能为空")
    @PositiveOrZero(message = "排序不能小于0")
    Integer sortOrder
) {
    public SkillProcessStateOperationRequest {
        operationKey = operationKey == null ? null : operationKey.trim();
        name = name == null ? null : name.trim();
        stateKey = stateKey == null ? null : stateKey.trim();
        valueFormulaKey = valueFormulaKey == null || valueFormulaKey.isBlank() ? null : valueFormulaKey.trim();
        optionKey = optionKey == null || optionKey.isBlank() ? null : optionKey.trim();
    }
}
