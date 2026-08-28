package xyz.game.datamanage.model.skillprocess;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.util.List;

public record SkillProcessCreateRequest(
    @NotBlank(message = "过程标识不能为空")
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "过程标识格式不合法")
    String processKey,
    @NotBlank(message = "过程名称不能为空")
    @Size(max = 100, message = "过程名称不能超过100个字符")
    String name,
    @NotNull(message = "启动方式不能为空")
    SkillProcessActivationType activationType,
    @Size(max = 2000, message = "说明不能超过2000个字符")
    String description,
    @NotNull(message = "排序不能为空")
    @PositiveOrZero(message = "排序不能小于0")
    Integer sortOrder,
    @Valid
    SkillProcessCooldown cooldown,
    @NotNull(message = "步骤列表不能缺失")
    @NotEmpty(message = "过程至少包含一个步骤")
    @Valid
    List<SkillProcessStepRequest> steps,
    @NotNull(message = "效果挂接列表不能缺失")
    @Valid
    List<SkillProcessEffectBindingRequest> effectBindings,
    @NotNull(message = "内部状态操作列表不能缺失")
    @Valid
    List<SkillProcessStateOperationRequest> stateOperations
) {
    public SkillProcessCreateRequest {
        processKey = processKey == null ? null : processKey.trim();
        name = name == null ? null : name.trim();
        if (description != null) {
            description = description.trim();
            description = description.isEmpty() ? null : description;
        }
    }
}
