package xyz.game.enginev2demo.pipeline;

import java.util.List;

import xyz.game.enginev2demo.trigger.TriggerEvent;

/**
 * 伤害管线的返回结果，包含结算详情和派生的触发事件。
 *
 * @param resolvedEvent       完整的伤害结算事件
 * @param derivedTriggerEvents 派生的触发事件（ON_DAMAGE_DEALT + ON_DAMAGE_TAKEN）
 */
public record DamagePipelineResult(
        DamageResolvedEvent resolvedEvent,
        List<TriggerEvent> derivedTriggerEvents) {
}
