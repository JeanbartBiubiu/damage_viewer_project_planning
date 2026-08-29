package xyz.game.datamanage.model.skilleffect;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.util.List;

public record SkillEffectCreateRequest(
    @NotBlank(message = "效果标识不能为空")
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "效果标识格式不合法")
    String effectKey,
    @NotBlank(message = "效果名称不能为空")
    @Size(max = 100, message = "效果名称不能超过100个字符")
    String name,
    @Size(max = 2000, message = "说明不能超过2000个字符")
    String description,
    @NotNull(message = "排序不能为空")
    @PositiveOrZero(message = "排序不能小于0")
    Integer sortOrder,
    @Valid
    SkillEffectLifecycleRequest lifecycle,
    @NotNull(message = "结果列表不能缺失")
    @NotEmpty(message = "效果至少包含一个结果")
    @Valid
    List<SkillEffectResultRequest> results
) {
    public SkillEffectCreateRequest {
        effectKey = effectKey == null ? null : effectKey.trim();
        name = name == null ? null : name.trim();
        if (description != null) {
            description = description.trim();
            description = description.isEmpty() ? null : description;
        }
    }

    public SkillEffectCreateRequest(
        String effectKey,
        String name,
        String description,
        Integer sortOrder,
        List<SkillEffectResultRequest> results
    ) {
        this(effectKey, name, description, sortOrder, null, results);
    }
}
