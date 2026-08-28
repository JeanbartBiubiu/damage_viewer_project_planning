package xyz.game.datamanage.model.skillprocess;

import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

@JsonDeserialize(using = SkillProcessStepRequestDeserializer.class)
public record SkillProcessStepRequest(
    @NotBlank(message = "步骤标识不能为空")
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "步骤标识格式不合法")
    String stepKey,
    @NotBlank(message = "步骤名称不能为空")
    @Size(max = 100, message = "步骤名称不能超过100个字符")
    String name,
    @NotNull(message = "步骤种类不能为空")
    SkillProcessStepType stepType,
    @Size(max = 2000, message = "说明不能超过2000个字符")
    String description,
    @NotNull(message = "排序不能为空")
    @PositiveOrZero(message = "排序不能小于0")
    Integer sortOrder,
    @NotNull(message = "步骤明细不能为空")
    @Valid
    SkillProcessStepDetail detail
) {
    public SkillProcessStepRequest {
        stepKey = stepKey == null ? null : stepKey.trim();
        name = name == null ? null : name.trim();
        if (description != null) {
            description = description.trim();
            description = description.isEmpty() ? null : description;
        }
    }
}
