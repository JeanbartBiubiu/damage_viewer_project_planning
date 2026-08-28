package xyz.game.datamanage.model.skillprocess;

import jakarta.validation.constraints.NotNull;

public record SkillProcessMoment(
    @NotNull(message = "过程时点种类不能为空")
    SkillProcessMomentType momentType,
    String stepKey
) {
    public SkillProcessMoment {
        stepKey = stepKey == null || stepKey.isBlank() ? null : stepKey.trim();
    }
}
