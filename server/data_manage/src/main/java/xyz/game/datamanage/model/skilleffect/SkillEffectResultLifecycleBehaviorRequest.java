package xyz.game.datamanage.model.skilleffect;

public record SkillEffectResultLifecycleBehaviorRequest(
    SkillEffectLifecycleMoment moment,
    SkillEffectLifecycleValueReadMode valueReadMode,
    SkillEffectLifecycleStackValueMode stackValueMode,
    SkillEffectLifecycleReapplicationValueMode reapplicationValueMode,
    SkillEffectLifecyclePeriodicExecutionMode periodicExecutionMode
) {
}
