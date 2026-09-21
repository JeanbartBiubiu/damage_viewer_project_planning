package xyz.game.datamanage.model.skilltrigger;

public enum SkillTriggerConditionType {
    ATTRIBUTE_COMPARE,
    STATUS_CHECK,
    INTERNAL_STATE_CHECK,
    LIFECYCLE_CHECK,
    TARGET_CATEGORY_CHECK,
    EXPLICIT_TARGET_IS_SOURCE,
    SKILL_HIT_TARGET_IS_ENEMY,
    EVENT_VALUE_COMPARE
}
