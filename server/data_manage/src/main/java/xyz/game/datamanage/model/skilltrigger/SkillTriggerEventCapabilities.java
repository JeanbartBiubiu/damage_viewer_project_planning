package xyz.game.datamanage.model.skilltrigger;

import java.util.EnumSet;
import java.util.Map;
import java.util.Set;
import xyz.game.datamanage.model.skillprocess.SkillProcessMomentType;
import xyz.game.datamanage.model.skillprocess.SkillProcessStepType;

public final class SkillTriggerEventCapabilities {

    private static final Set<SkillTriggerEventType> EVENT_SOURCE_EVENTS = EnumSet.of(
        SkillTriggerEventType.SOURCE_INITIALIZED,
        SkillTriggerEventType.DAMAGE_PENDING,
        SkillTriggerEventType.DAMAGE_TAKEN,
        SkillTriggerEventType.STATUS_CHANGED,
        SkillTriggerEventType.CONTROL_RECEIVED,
        SkillTriggerEventType.SPELL_SHIELD_BLOCKED
    );

    private static final Set<SkillTriggerEventType> EMPTY_DETAIL_EVENTS = EnumSet.of(
        SkillTriggerEventType.SOURCE_INITIALIZED,
        SkillTriggerEventType.BASIC_ATTACK_START,
        SkillTriggerEventType.BASIC_ATTACK_HIT,
        SkillTriggerEventType.CONTROL_RECEIVED,
        SkillTriggerEventType.KILL,
        SkillTriggerEventType.TAKEDOWN
    );

    private SkillTriggerEventCapabilities() {
    }

    public static boolean hasEventSource(SkillTriggerEventType eventType) {
        return eventType != null && EVENT_SOURCE_EVENTS.contains(eventType);
    }

    public static boolean requiresEmptyDetail(SkillTriggerEventType eventType) {
        return eventType != null && EMPTY_DETAIL_EVENTS.contains(eventType);
    }

    public static boolean sourceCastResourceCostAvailable(SkillTriggerEventType eventType, String sourceSkillKey) {
        return eventType == SkillTriggerEventType.SKILL_HIT && sourceSkillKey != null && !sourceSkillKey.isBlank();
    }

    public static boolean sourceCastResourceCostAvailable(
        SkillTriggerEventType eventType,
        String sourceSkillKey,
        SkillProcessMomentType momentType,
        boolean currentSkillNonPassiveProcess
    ) {
        if (sourceCastResourceCostAvailable(eventType, sourceSkillKey)) {
            return true;
        }
        return eventType == SkillTriggerEventType.PROCESS_MOMENT
            && currentSkillNonPassiveProcess
            && (momentType == SkillProcessMomentType.PROCESS_COMPLETE
                || momentType == SkillProcessMomentType.PROCESS_FAILURE);
    }

    public static SkillTriggerValueDomain valueDomain(SkillTriggerEventValueKey valueKey) {
        if (valueKey == null) {
            return null;
        }
        return switch (valueKey) {
            case STEP_EXECUTION_INDEX, RECAST_COUNT, HIT_INDEX, SKILL_HIT_FIRST_CONTACT, LIFECYCLE_STACKS,
                PERIOD_INDEX, STATE_BEFORE, STATE_AFTER,
                BLOCKED, IMMUNE, KILLED, LINK_INDEX, LINK_COUNT, SKILL_HIT_SPELL_SHIELD_BLOCKED -> SkillTriggerValueDomain.INTEGER;
            case CHARGE_DURATION_MS, REMAINING_MS, ATTRIBUTE_BEFORE, ATTRIBUTE_AFTER,
                THRESHOLD_VALUE, RAW_DAMAGE, POST_DEFENSE_DAMAGE, HEALTH_BEFORE,
                PROJECTED_HEALTH_AFTER, SHIELD_ABSORBED, ACTUAL_HP_LOSS -> SkillTriggerValueDomain.DECIMAL;
        };
    }

    public static boolean eventValueAllowed(
        SkillTriggerEventType eventType,
        SkillTriggerEventValueKey valueKey,
        SkillProcessMomentType momentType,
        SkillProcessStepType stepType
    ) {
        if (eventType == null || valueKey == null) {
            return false;
        }
        return switch (eventType) {
            case DAMAGE_PENDING -> valueKey == SkillTriggerEventValueKey.RAW_DAMAGE
                || valueKey == SkillTriggerEventValueKey.POST_DEFENSE_DAMAGE
                || valueKey == SkillTriggerEventValueKey.HEALTH_BEFORE
                || valueKey == SkillTriggerEventValueKey.PROJECTED_HEALTH_AFTER;
            case DAMAGE_DEALT, DAMAGE_TAKEN -> valueKey == SkillTriggerEventValueKey.RAW_DAMAGE
                || valueKey == SkillTriggerEventValueKey.POST_DEFENSE_DAMAGE
                || valueKey == SkillTriggerEventValueKey.SHIELD_ABSORBED
                || valueKey == SkillTriggerEventValueKey.ACTUAL_HP_LOSS
                || valueKey == SkillTriggerEventValueKey.BLOCKED
                || valueKey == SkillTriggerEventValueKey.IMMUNE
                || valueKey == SkillTriggerEventValueKey.KILLED;
            case HIT_LINK_APPLIED, ATTACK_LINK_APPLIED -> valueKey == SkillTriggerEventValueKey.LINK_INDEX
                || valueKey == SkillTriggerEventValueKey.LINK_COUNT;
            case SPELL_SHIELD_BLOCKED, TAKEDOWN -> false;
            case BASIC_ATTACK_HIT -> valueKey == SkillTriggerEventValueKey.HIT_INDEX;
            case SKILL_HIT -> valueKey == SkillTriggerEventValueKey.HIT_INDEX
                || valueKey == SkillTriggerEventValueKey.SKILL_HIT_FIRST_CONTACT
                || valueKey == SkillTriggerEventValueKey.SKILL_HIT_SPELL_SHIELD_BLOCKED;
            case PROCESS_MOMENT -> processMomentValueAllowed(valueKey, momentType, stepType);
            case LIFECYCLE_MOMENT -> false;
            case HEALTH_THRESHOLD_CROSSED -> valueKey == SkillTriggerEventValueKey.ATTRIBUTE_BEFORE
                || valueKey == SkillTriggerEventValueKey.ATTRIBUTE_AFTER
                || valueKey == SkillTriggerEventValueKey.THRESHOLD_VALUE;
            case INTERNAL_STATE_CHANGED -> valueKey == SkillTriggerEventValueKey.STATE_BEFORE
                || valueKey == SkillTriggerEventValueKey.STATE_AFTER;
            default -> false;
        };
    }

    public static boolean lifecycleEventValueAllowed(
        SkillTriggerEventValueKey valueKey,
        SkillTriggerLifecycleEventMoment moment
    ) {
        if (valueKey == null) {
            return false;
        }
        return switch (valueKey) {
            case LIFECYCLE_STACKS, REMAINING_MS -> true;
            case PERIOD_INDEX -> moment == SkillTriggerLifecycleEventMoment.PERIODIC;
            default -> false;
        };
    }

    public static boolean internalStateEventValueAllowed(
        SkillTriggerEventValueKey valueKey,
        SkillTriggerInternalStateChangeKind changeKind
    ) {
        return (valueKey == SkillTriggerEventValueKey.STATE_BEFORE
            || valueKey == SkillTriggerEventValueKey.STATE_AFTER)
            && changeKind == SkillTriggerInternalStateChangeKind.VALUE_CHANGED;
    }

    private static boolean processMomentValueAllowed(
        SkillTriggerEventValueKey valueKey,
        SkillProcessMomentType momentType,
        SkillProcessStepType stepType
    ) {
        return switch (valueKey) {
            case STEP_EXECUTION_INDEX -> momentType == SkillProcessMomentType.STEP_EXECUTION;
            case CHARGE_DURATION_MS -> stepType == SkillProcessStepType.CHARGE
                && (momentType == SkillProcessMomentType.STEP_EXECUTION
                    || momentType == SkillProcessMomentType.STEP_COMPLETE
                    || momentType == SkillProcessMomentType.STEP_TIMEOUT);
            case RECAST_COUNT -> stepType == SkillProcessStepType.RECAST
                && (momentType == SkillProcessMomentType.STEP_EXECUTION
                    || momentType == SkillProcessMomentType.STEP_COMPLETE
                    || momentType == SkillProcessMomentType.STEP_TIMEOUT);
            default -> false;
        };
    }

    public static Map<SkillTriggerEventType, String> currentTargetBindings() {
        return Map.ofEntries(
            Map.entry(SkillTriggerEventType.SOURCE_INITIALIZED, "被初始化的来源对象自身；不是其战斗目标"),
            Map.entry(SkillTriggerEventType.SKILL_USED, "该次技能使用的显式目标；没有时为来源对象"),
            Map.entry(SkillTriggerEventType.BASIC_ATTACK_START, "本次普通攻击目标"),
            Map.entry(SkillTriggerEventType.BASIC_ATTACK_HIT, "本次普通攻击命中的对象"),
            Map.entry(SkillTriggerEventType.SKILL_HIT, "本次技能命中的对象"),
            Map.entry(SkillTriggerEventType.PROCESS_MOMENT, "目标过程实例的目标；没有时为来源对象"),
            Map.entry(SkillTriggerEventType.RESULT_AVAILABLE, "目标效果执行上下文的目标；没有时为来源对象"),
            Map.entry(SkillTriggerEventType.LIFECYCLE_MOMENT, "目标生命周期实例的承受对象"),
            Map.entry(SkillTriggerEventType.DAMAGE_PENDING, "来源对象自身"),
            Map.entry(SkillTriggerEventType.DAMAGE_DEALT, "本次伤害承受对象"),
            Map.entry(SkillTriggerEventType.DAMAGE_TAKEN, "来源对象自身"),
            Map.entry(SkillTriggerEventType.STATUS_CHANGED, "subject 指定的状态变化对象"),
            Map.entry(SkillTriggerEventType.HEALTH_THRESHOLD_CROSSED, "subject 指定的生命属性变化对象"),
            Map.entry(SkillTriggerEventType.INTERNAL_STATE_CHANGED, "TARGET 范围状态的实例目标；技能范围状态为来源对象"),
            Map.entry(SkillTriggerEventType.CONTROL_RECEIVED, "来源对象自身"),
            Map.entry(SkillTriggerEventType.ENTITY_DIED, "subject 指定的死亡对象"),
            Map.entry(SkillTriggerEventType.ENTITY_UNTARGETABLE, "subject 指定的不可选取对象"),
            Map.entry(SkillTriggerEventType.KILL, "本次被击杀对象"),
            Map.entry(SkillTriggerEventType.TAKEDOWN, "本次死亡对象（来源对象获记击杀或助攻）"),
            Map.entry(SkillTriggerEventType.PROCESS_CANCEL_REQUESTED, "目标过程实例的目标；没有时为来源对象"),
            Map.entry(SkillTriggerEventType.SPELL_SHIELD_BLOCKED, "法术护盾承受对象（技能拥有者自身）"),
            Map.entry(SkillTriggerEventType.HIT_LINK_APPLIED, "本次联动目标"),
            Map.entry(SkillTriggerEventType.ATTACK_LINK_APPLIED, "本次联动目标")
        );
    }
}
