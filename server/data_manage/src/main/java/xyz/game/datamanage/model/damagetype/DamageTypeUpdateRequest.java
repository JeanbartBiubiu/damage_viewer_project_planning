package xyz.game.datamanage.model.damagetype;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Null;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

public record DamageTypeUpdateRequest(
    @Null(message = "伤害类型标识不能修改")
    String damageTypeKey,
    @NotBlank(message = "伤害类型名称不能为空")
    @Size(max = 100, message = "伤害类型名称不能超过100个字符")
    String name,
    @Size(max = 2000, message = "说明不能超过2000个字符")
    String description,
    @NotNull(message = "状态不能为空")
    DamageTypeStatus status,
    @NotNull(message = "排序不能为空")
    @PositiveOrZero(message = "排序不能小于0")
    Integer sortOrder
) {
    public DamageTypeUpdateRequest {
        name = name == null ? null : name.trim();
        if (description != null) {
            description = description.trim();
            description = description.isEmpty() ? null : description;
        }
    }
}
