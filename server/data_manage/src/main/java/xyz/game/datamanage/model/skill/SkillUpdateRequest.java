package xyz.game.datamanage.model.skill;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Null;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.util.List;

public record SkillUpdateRequest(
    @Null(message = "技能标识不能修改")
    String skillKey,
    @NotBlank(message = "技能名称不能为空")
    @Size(max = 100, message = "技能名称不能超过100个字符")
    String name,
    @Size(max = 2000, message = "说明不能超过2000个字符")
    String description,
    @NotNull(message = "最大等级不能为空")
    @Min(value = 1, message = "最大等级不能小于1")
    Integer maxLevel,
    @NotNull(message = "状态不能为空")
    SkillStatus status,
    @NotNull(message = "排序不能为空")
    @PositiveOrZero(message = "排序不能小于0")
    Integer sortOrder,
    @NotNull(message = "技能分类列表不能缺失")
    List<String> skillCategoryKeys
) {
    public SkillUpdateRequest {
        name = name == null ? null : name.trim();
        if (description != null) {
            description = description.trim();
            description = description.isEmpty() ? null : description;
        }
    }
}
