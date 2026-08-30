package xyz.game.datamanage.model.skilltrigger;

public record SkillTriggerLifecycleEventRow(
    String gameId,
    String skillKey,
    String ruleKey,
    String effectKey,
    SkillTriggerLifecycleEventMoment lifecycleMoment
) {
}
