package xyz.game.datamanage.model.skilleffect;

public record SkillEffectLifecycleResponse(
    String durationFormulaKey,
    String maxStacksFormulaKey,
    String applicationStacksFormulaKey,
    SkillEffectLifecycleInstanceScope instanceScope,
    SkillEffectLifecycleReapplicationStackMode reapplicationStackMode,
    SkillEffectLifecycleReapplicationDurationMode reapplicationDurationMode,
    SkillEffectLifecycleExpiryMode expiryMode,
    String periodicIntervalFormulaKey,
    SkillEffectLifecycleFirstPeriodicExecution firstPeriodicExecution
) {
}
