package xyz.game.enginev2demo.action;

import java.util.List;
import java.util.Map;
import java.util.Objects;

import xyz.game.enginev2demo.trigger.TriggerSubscriptionDef;

/**
 * 动作模板。
 * <p>
 * 所有动作统一使用 {@code cooldownFormulaId} 计算冷却时长，
 * {@code autoRepeat=true} 的动作成功后引擎自动安排下一次同动作同目标的施放。
 * <p>
 * {@code maxCharges} 控制充能层数（默认 1 = 非充能动作），
 * {@code tags} 用于节奏修改效果的目标匹配（字符串交集命中）。
 */
public record ActionTemplate(
        String actionId,
        String label,
        String damageProfileId,
        String formulaId,
        String cooldownFormulaId,
        boolean autoRepeat,
        int maxCharges,
        List<String> tags,
        Map<String, Double> resourceCosts,
        List<ActionGateDef> actionGates,
        List<TriggerSubscriptionDef> triggerSubscriptions) {

    public ActionTemplate {
        Objects.requireNonNull(actionId, "actionId");
        Objects.requireNonNull(label, "label");
        Objects.requireNonNull(damageProfileId, "damageProfileId");
        Objects.requireNonNull(formulaId, "formulaId");
        Objects.requireNonNull(cooldownFormulaId, "cooldownFormulaId");
        if (maxCharges < 1) {
            throw new IllegalArgumentException("maxCharges must be >= 1");
        }
        Objects.requireNonNull(tags, "tags");
        Objects.requireNonNull(resourceCosts, "resourceCosts");
        Objects.requireNonNull(actionGates, "actionGates");
        Objects.requireNonNull(triggerSubscriptions, "triggerSubscriptions");
        tags = List.copyOf(tags);
        resourceCosts = Map.copyOf(resourceCosts);
        actionGates = List.copyOf(actionGates);
        triggerSubscriptions = List.copyOf(triggerSubscriptions);
    }
}
