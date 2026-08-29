package xyz.game.datamanage.model.skilleffect;

import jakarta.validation.constraints.Pattern;

public record SkillEffectLifecycleRequest(
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "持续时间公式标识格式不合法")
    String durationFormulaKey,
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "最大层数公式标识格式不合法")
    String maxStacksFormulaKey,
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "每次施加层数公式标识格式不合法")
    String applicationStacksFormulaKey,
    SkillEffectLifecycleInstanceScope instanceScope,
    SkillEffectLifecycleReapplicationStackMode reapplicationStackMode,
    SkillEffectLifecycleReapplicationDurationMode reapplicationDurationMode,
    SkillEffectLifecycleExpiryMode expiryMode,
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "周期间隔公式标识格式不合法")
    String periodicIntervalFormulaKey,
    SkillEffectLifecycleFirstPeriodicExecution firstPeriodicExecution
) {
    public SkillEffectLifecycleRequest {
        durationFormulaKey = trimToNull(durationFormulaKey);
        maxStacksFormulaKey = trimToNull(maxStacksFormulaKey);
        applicationStacksFormulaKey = trimToNull(applicationStacksFormulaKey);
        periodicIntervalFormulaKey = trimToNull(periodicIntervalFormulaKey);
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
