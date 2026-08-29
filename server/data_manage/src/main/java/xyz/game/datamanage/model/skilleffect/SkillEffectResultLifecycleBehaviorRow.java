package xyz.game.datamanage.model.skilleffect;

public record SkillEffectResultLifecycleBehaviorRow(
    String gameId,
    String skillKey,
    String effectKey,
    String resultKey,
    SkillEffectLifecycleMoment moment,
    SkillEffectLifecycleValueReadMode valueReadMode,
    SkillEffectLifecycleStackValueMode stackValueMode,
    SkillEffectLifecycleReapplicationValueMode reapplicationValueMode,
    SkillEffectLifecyclePeriodicExecutionMode periodicExecutionMode
) {
}
