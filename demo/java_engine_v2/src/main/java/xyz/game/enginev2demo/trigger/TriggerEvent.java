package xyz.game.enginev2demo.trigger;

import java.util.Map;
import java.util.Objects;

import xyz.game.enginev2demo.crit.ExecutionCritResult;
import xyz.game.enginev2demo.pipeline.DamageResolvedEvent;
import xyz.game.enginev2demo.runtime.CounterScope;
import xyz.game.enginev2demo.runtime.StatusInstance;

/**
 * 触发事件。
 *
 * @param executionCritResult source 侧 execution 暴击结果（可为 null = 不携带暴击上下文）
 * @param actionCritType      动作级 critType 标签（可为 null）
 */
public record TriggerEvent(
        TriggerType type,
        String sourceActorId,
        String targetActorId,
        String actionId,
        String damageProfileId,
        Map<String, Double> inputValues,
        Map<String, String> refs,
        ExecutionCritResult executionCritResult,
        String actionCritType) {

    public TriggerEvent {
        Objects.requireNonNull(type, "type");
        inputValues = Map.copyOf(inputValues);
        refs = Map.copyOf(refs);
    }

    /** 向后兼容构造——不带暴击上下文。 */
    public TriggerEvent(
            TriggerType type,
            String sourceActorId,
            String targetActorId,
            String actionId,
            String damageProfileId,
            Map<String, Double> inputValues,
            Map<String, String> refs) {
        this(type, sourceActorId, targetActorId, actionId, damageProfileId, inputValues, refs, null, null);
    }

    public static TriggerEvent actionCast(String sourceActorId, String targetActorId, String actionId) {
        return new TriggerEvent(TriggerType.ON_ACTION_CAST, sourceActorId, targetActorId, actionId, null, Map.of(), Map.of());
    }

    public static TriggerEvent actionCast(String sourceActorId, String targetActorId, String actionId,
                                           ExecutionCritResult executionCritResult, String actionCritType) {
        return new TriggerEvent(TriggerType.ON_ACTION_CAST, sourceActorId, targetActorId, actionId, null,
                Map.of(), Map.of(), executionCritResult, actionCritType);
    }

    public static TriggerEvent damageDealt(DamageResolvedEvent resolvedEvent) {
        return damageEvent(TriggerType.ON_DAMAGE_DEALT, resolvedEvent);
    }

    public static TriggerEvent damageTaken(DamageResolvedEvent resolvedEvent) {
        // target 侧不携带 execution crit 结果
        return new TriggerEvent(
                TriggerType.ON_DAMAGE_TAKEN,
                resolvedEvent.sourceActorId(),
                resolvedEvent.targetActorId(),
                resolvedEvent.actionId(),
                resolvedEvent.damageProfileId(),
                damageInputValues(resolvedEvent),
                Map.of(),
                null,
                null);
    }

    public static TriggerEvent statusApplied(StatusInstance statusInstance) {
        return new TriggerEvent(
                TriggerType.ON_STATUS_APPLIED,
                statusInstance.sourceActorId(),
                statusInstance.ownerActorId(),
                null,
                null,
                Map.of("status_magnitude", statusInstance.magnitude()),
                Map.of("status_id", statusInstance.statusId(), "status_kind", statusInstance.statusKind().name()));
    }

    public static TriggerEvent statusExpired(StatusInstance statusInstance) {
        return new TriggerEvent(
                TriggerType.ON_STATUS_EXPIRED,
                statusInstance.sourceActorId(),
                statusInstance.ownerActorId(),
                null,
                null,
                Map.of("status_magnitude", statusInstance.magnitude()),
                Map.of("status_id", statusInstance.statusId(), "status_kind", statusInstance.statusKind().name()));
    }

    public static TriggerEvent counterThreshold(
            String sourceActorId,
            String targetActorId,
            String counterId,
            CounterScope counterScope,
            int counterValue) {
        return new TriggerEvent(
                TriggerType.ON_COUNTER_THRESHOLD,
                sourceActorId,
                targetActorId,
                null,
                null,
                Map.of("counter_value", (double) counterValue),
                Map.of("counter_id", counterId, "counter_scope", counterScope.name()));
    }

    public static TriggerEvent markApplied(String sourceActorId, String targetActorId, String markId) {
        return new TriggerEvent(
                TriggerType.ON_MARK_APPLIED,
                sourceActorId,
                targetActorId,
                null,
                null,
                Map.of(),
                Map.of("mark_id", markId));
    }

    public static TriggerEvent markConsumed(String sourceActorId, String targetActorId, String markId) {
        return new TriggerEvent(
                TriggerType.ON_MARK_CONSUMED,
                sourceActorId,
                targetActorId,
                null,
                null,
                Map.of(),
                Map.of("mark_id", markId));
    }

    private static TriggerEvent damageEvent(TriggerType triggerType, DamageResolvedEvent resolvedEvent) {
        // ON_DAMAGE_DEALT 携带暴击结果，ON_DAMAGE_TAKEN 不携带
        ExecutionCritResult critResult = (triggerType == TriggerType.ON_DAMAGE_DEALT && resolvedEvent.isCritical())
                ? ExecutionCritResult.crit(resolvedEvent.critMultiplier(), resolvedEvent.critType())
                : (triggerType == TriggerType.ON_DAMAGE_DEALT
                        ? ExecutionCritResult.noCrit()
                        : null);
        return new TriggerEvent(
                triggerType,
                resolvedEvent.sourceActorId(),
                resolvedEvent.targetActorId(),
                resolvedEvent.actionId(),
                resolvedEvent.damageProfileId(),
                damageInputValues(resolvedEvent),
                Map.of(),
                critResult,
                resolvedEvent.critType());
    }

    private static Map<String, Double> damageInputValues(DamageResolvedEvent resolvedEvent) {
        return Map.of(
                "raw_damage", resolvedEvent.rawDamage(),
                "dealt_damage", resolvedEvent.dealtDamage(),
                "shield_absorbed", resolvedEvent.shieldAbsorbed(),
                "hp_damage", resolvedEvent.hpDamage(),
                "effective_resistance", resolvedEvent.effectiveResistance(),
                "mitigation_multiplier", resolvedEvent.mitigationMultiplier());
    }
}
