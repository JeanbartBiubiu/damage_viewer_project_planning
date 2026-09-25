package xyz.game.datamanage.model.skilleffect;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.Valid;
import xyz.game.datamanage.model.value.SkillNumericValue;

public record SkillEffectLifecycleRequest(
    @Valid
    SkillNumericValue durationValue,
    @Valid
    SkillNumericValue maxStacksValue,
    @Valid
    SkillNumericValue applicationStacksValue,
    SkillEffectLifecycleInstanceScope instanceScope,
    SkillEffectLifecycleReapplicationStackMode reapplicationStackMode,
    SkillEffectLifecycleReapplicationDurationMode reapplicationDurationMode,
    SkillEffectLifecycleExpiryMode expiryMode,
    @Valid
    SkillNumericValue periodicIntervalValue,
    SkillEffectLifecycleFirstPeriodicExecution firstPeriodicExecution
) {
    @JsonAnySetter
    public void rejectUnknownField(String fieldName, Object ignored) {
        throw new IllegalArgumentException("未知字段：" + fieldName);
    }
}
