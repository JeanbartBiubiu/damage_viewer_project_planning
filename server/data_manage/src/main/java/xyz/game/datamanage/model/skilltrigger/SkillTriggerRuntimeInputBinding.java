package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

@JsonDeserialize(using = SkillTriggerRuntimeInputBindingDeserializer.class)
public record SkillTriggerRuntimeInputBinding(
    @NotBlank(message = "绑定标识不能为空")
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "绑定标识格式不合法")
    String bindingKey,
    @NotBlank(message = "参数标识不能为空")
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "参数标识格式不合法")
    String parameterKey,
    @NotNull(message = "来源种类不能为空")
    SkillTriggerRuntimeInputSourceType sourceType,
    @NotNull(message = "来源明细不能为空")
    @Valid
    SkillTriggerRuntimeInputBindingDetail detail
) {
    public SkillTriggerRuntimeInputBinding {
        bindingKey = bindingKey == null ? null : bindingKey.trim();
        parameterKey = parameterKey == null ? null : parameterKey.trim();
    }
}
