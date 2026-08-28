package xyz.game.datamanage.model.skilleffect;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Null;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.util.List;

public record SkillEffectUpdateRequest(
    @Null(message = "效果标识不能修改")
    String effectKey,
    @NotBlank(message = "效果名称不能为空")
    @Size(max = 100, message = "效果名称不能超过100个字符")
    String name,
    @Size(max = 2000, message = "说明不能超过2000个字符")
    String description,
    @NotNull(message = "排序不能为空")
    @PositiveOrZero(message = "排序不能小于0")
    Integer sortOrder,
    @NotNull(message = "结果列表不能缺失")
    @NotEmpty(message = "效果至少包含一个结果")
    @Valid
    List<SkillEffectResultRequest> results
) {
    public SkillEffectUpdateRequest {
        name = name == null ? null : name.trim();
        if (description != null) {
            description = description.trim();
            description = description.isEmpty() ? null : description;
        }
    }
}
