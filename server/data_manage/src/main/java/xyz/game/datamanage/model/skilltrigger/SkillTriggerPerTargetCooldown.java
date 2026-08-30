package xyz.game.datamanage.model.skilltrigger;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

public record SkillTriggerPerTargetCooldown(
    @NotBlank(message = "每目标冷却公式不能为空")
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "每目标冷却公式标识格式不合法")
    String durationFormulaKey,
    @NotNull(message = "每目标冷却目标对象不能为空")
    SkillTriggerTargetContext targetContext
) {
    public SkillTriggerPerTargetCooldown {
        durationFormulaKey = durationFormulaKey == null ? null : durationFormulaKey.trim();
    }
}
