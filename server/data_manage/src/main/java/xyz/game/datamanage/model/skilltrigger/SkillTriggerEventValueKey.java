package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.databind.JsonNode;

public enum SkillTriggerEventValueKey {
    STEP_EXECUTION_INDEX,
    CHARGE_DURATION_MS,
    RECAST_COUNT,
    HIT_INDEX,
    LIFECYCLE_STACKS,
    PERIOD_INDEX,
    REMAINING_MS,
    STATE_BEFORE,
    STATE_AFTER,
    ATTRIBUTE_BEFORE,
    ATTRIBUTE_AFTER,
    THRESHOLD_VALUE,
    RAW_DAMAGE,
    POST_DEFENSE_DAMAGE,
    HEALTH_BEFORE,
    PROJECTED_HEALTH_AFTER,
    SHIELD_ABSORBED,
    ACTUAL_HP_LOSS,
    BLOCKED,
    IMMUNE,
    KILLED,
    LINK_INDEX,
    LINK_COUNT,
    SKILL_HIT_SPELL_SHIELD_BLOCKED;

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public static SkillTriggerEventValueKey fromJson(JsonNode node) {
        if (node == null || node.isNull()) return null;
        if (!node.isTextual()) throw new IllegalArgumentException("事件值必须为明确的标识，不能使用数字序号");
        return valueOf(node.textValue());
    }
}
