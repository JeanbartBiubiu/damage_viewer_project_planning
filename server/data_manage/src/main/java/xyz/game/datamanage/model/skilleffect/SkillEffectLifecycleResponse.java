package xyz.game.datamanage.model.skilleffect;

import xyz.game.datamanage.model.value.SkillNumericValue;

public record SkillEffectLifecycleResponse(
    SkillNumericValue durationValue,
    SkillNumericValue maxStacksValue,
    SkillNumericValue applicationStacksValue,
    SkillEffectLifecycleInstanceScope instanceScope,
    SkillEffectLifecycleReapplicationStackMode reapplicationStackMode,
    SkillEffectLifecycleReapplicationDurationMode reapplicationDurationMode,
    SkillEffectLifecycleExpiryMode expiryMode,
    SkillNumericValue periodicIntervalValue,
    SkillEffectLifecycleFirstPeriodicExecution firstPeriodicExecution
) {
}
