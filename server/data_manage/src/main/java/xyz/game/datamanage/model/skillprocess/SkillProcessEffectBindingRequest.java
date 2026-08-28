package xyz.game.datamanage.model.skillprocess;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;

public record SkillProcessEffectBindingRequest(
    @NotBlank(message = "效果挂接标识不能为空")
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "效果挂接标识格式不合法")
    String bindingKey,
    @NotBlank(message = "效果标识不能为空")
    String effectKey,
    @NotNull(message = "过程时点不能为空")
    @Valid
    SkillProcessMoment moment,
    @NotNull(message = "排序不能为空")
    @PositiveOrZero(message = "排序不能小于0")
    Integer sortOrder
) {
    public SkillProcessEffectBindingRequest {
        bindingKey = bindingKey == null ? null : bindingKey.trim();
        effectKey = effectKey == null ? null : effectKey.trim();
    }
}
