package xyz.game.enginev2demo.trigger;

import java.util.List;
import java.util.Objects;

/**
 * 触发订阅定义——声明一个觋听什么事件、如何匹配以及触发当后执行哪些效果。
 *
 * @param triggerType            触发事件类型
 * @param ownerEventRole         归属者在升为 source 还是 target 觳度处理订阅
 * @param conditionFormulaId     条件公式 ID（>0 才触发，null 表示无条件）
 * @param requiresPositiveDamage 为 true 时过滤掉 dealt_damage<=0 的事件
 * @param effects                触发后执行的效果列表（不得为空）
 */
public record TriggerSubscriptionDef(
        TriggerType triggerType,
        EventActorRole ownerEventRole,
        String conditionFormulaId,
        boolean requiresPositiveDamage,
        List<EffectDef> effects) {

    public TriggerSubscriptionDef {
        Objects.requireNonNull(triggerType, "triggerType");
        Objects.requireNonNull(ownerEventRole, "ownerEventRole");
        Objects.requireNonNull(effects, "effects");
        effects = List.copyOf(effects);
        if (effects.isEmpty()) {
            throw new IllegalArgumentException("effects must not be empty");
        }
    }

    public TriggerSubscriptionDef(
            TriggerType triggerType,
            EventActorRole ownerEventRole,
            boolean requiresPositiveDamage,
            List<EffectDef> effects) {
        this(triggerType, ownerEventRole, null, requiresPositiveDamage, effects);
    }
}
