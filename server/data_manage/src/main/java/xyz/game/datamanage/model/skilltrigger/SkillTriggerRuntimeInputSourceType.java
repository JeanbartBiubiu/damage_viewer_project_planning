package xyz.game.datamanage.model.skilltrigger;

public enum SkillTriggerRuntimeInputSourceType {
    INTERNAL_STATE,
    COMBAT_STATUS,
    COMBAT_ELAPSED_TIME,
    RECENT_DAMAGE_SUM,
    EVENT_VALUE,
    SOURCE_CAST_RESOURCE_COST,
    PRIOR_ACTION_RESULT
}
