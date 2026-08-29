package xyz.game.datamanage.model.skilleffect;

public record SkillEffectResultLifecycleBehaviorResponse(
    SkillEffectLifecycleMoment moment,
    SkillEffectLifecycleValueReadMode valueReadMode,
    SkillEffectLifecycleStackValueMode stackValueMode,
    SkillEffectLifecycleReapplicationValueMode reapplicationValueMode,
    SkillEffectLifecyclePeriodicExecutionMode periodicExecutionMode
) {
}
