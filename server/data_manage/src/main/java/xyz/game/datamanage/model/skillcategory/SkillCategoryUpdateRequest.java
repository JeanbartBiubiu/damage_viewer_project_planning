package xyz.game.datamanage.model.skillcategory;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Null;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

public record SkillCategoryUpdateRequest(
    @Null(message = "技能分类标识不能修改")
    String skillCategoryKey,
    @NotBlank(message = "技能分类名称不能为空")
    @Size(max = 100, message = "技能分类名称不能超过100个字符")
    String name,
    @Size(max = 2000, message = "说明不能超过2000个字符")
    String description,
    @NotNull(message = "状态不能为空")
    SkillCategoryStatus status,
    @NotNull(message = "排序不能为空")
    @PositiveOrZero(message = "排序不能小于0")
    Integer sortOrder
) {
    public SkillCategoryUpdateRequest {
        name = name == null ? null : name.trim();
        if (description != null) {
            description = description.trim();
            description = description.isEmpty() ? null : description;
        }
    }
}
