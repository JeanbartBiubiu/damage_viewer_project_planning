package xyz.game.datamanage.model.skillprocess;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record SkillProcessCooldown(
    @NotBlank(message = "冷却时长公式不能为空")
    String durationFormulaKey,
    @NotNull(message = "冷却开始时点不能为空")
    @Valid
    SkillProcessMoment startMoment
) {
    public SkillProcessCooldown {
        durationFormulaKey = durationFormulaKey == null ? null : durationFormulaKey.trim();
    }
}
