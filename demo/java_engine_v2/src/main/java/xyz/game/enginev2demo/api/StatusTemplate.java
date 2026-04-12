package xyz.game.enginev2demo.api;

import java.util.List;
import java.util.Objects;

import xyz.game.enginev2demo.runtime.StatusKind;
import xyz.game.enginev2demo.runtime.StatusRefreshPolicy;
import xyz.game.enginev2demo.trigger.TriggerSubscriptionDef;

/**
 * 状态模板。
 */
public record StatusTemplate(
        String statusId,
        String label,
        StatusKind statusKind,
        long durationMs,
        StatusRefreshPolicy refreshPolicy,
        String magnitudeFormulaId,
        List<AttrModifierDef> attrModifiers,
        List<TriggerSubscriptionDef> triggerSubscriptions) {

    public StatusTemplate {
        Objects.requireNonNull(statusId, "statusId");
        Objects.requireNonNull(label, "label");
        Objects.requireNonNull(statusKind, "statusKind");
        Objects.requireNonNull(refreshPolicy, "refreshPolicy");
        Objects.requireNonNull(attrModifiers, "attrModifiers");
        Objects.requireNonNull(triggerSubscriptions, "triggerSubscriptions");
        if (durationMs < 0) {
            throw new IllegalArgumentException("durationMs must be >= 0");
        }
        attrModifiers = List.copyOf(attrModifiers);
        triggerSubscriptions = List.copyOf(triggerSubscriptions);
    }

    public StatusTemplate(
            String statusId,
            String label) {
        this(
                statusId,
                label,
                StatusKind.SHIELD,
                0L,
                StatusRefreshPolicy.TAKE_MAX,
                null,
                List.of(),
                List.of());
    }
}
