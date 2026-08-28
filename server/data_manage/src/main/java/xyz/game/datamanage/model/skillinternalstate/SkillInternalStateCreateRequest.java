package xyz.game.datamanage.model.skillinternalstate;

import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

@JsonDeserialize(using = SkillInternalStateCreateRequestDeserializer.class)
public record SkillInternalStateCreateRequest(
    @NotBlank(message = "内部状态标识不能为空")
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "内部状态标识格式不合法")
    String stateKey,
    @NotBlank(message = "内部状态名称不能为空")
    @Size(max = 100, message = "内部状态名称不能超过100个字符")
    String name,
    @NotNull(message = "内部状态种类不能为空")
    SkillInternalStateType stateType,
    @NotNull(message = "内部状态范围不能为空")
    SkillInternalStateScope scope,
    @Size(max = 2000, message = "说明不能超过2000个字符")
    String description,
    @NotNull(message = "排序不能为空")
    @PositiveOrZero(message = "排序不能小于0")
    Integer sortOrder,
    @NotNull(message = "内部状态明细不能为空")
    @Valid
    SkillInternalStateDetail detail
) {
    public SkillInternalStateCreateRequest {
        stateKey = stateKey == null ? null : stateKey.trim();
        name = name == null ? null : name.trim();
        if (description != null) {
            description = description.trim();
            description = description.isEmpty() ? null : description;
        }
    }
}
