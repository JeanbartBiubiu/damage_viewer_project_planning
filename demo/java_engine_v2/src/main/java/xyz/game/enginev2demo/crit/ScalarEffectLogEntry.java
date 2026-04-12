package xyz.game.enginev2demo.crit;

import xyz.game.enginev2demo.api.EngineLogEntry;

/**
 * 通用数值效果日志条目——记录护盾、治疗、status magnitude/duration、
 * attr modifier value、cadence modify value 等可暴击数值效果。
 *
 * @param timeMs          时间戳
 * @param sourceActorId   来源 actor
 * @param targetActorId   目标 actor
 * @param actionId        动作 ID（可为 null）
 * @param effectKind      效果种类标签（shield / status_magnitude / status_duration / attr_modifier / cadence_modify）
 * @param baseValue       基础值
 * @param finalValue      暴击后最终值
 * @param isCritical      是否暴击
 * @param critMultiplier  暴击倍率
 * @param critType        暴击类型标签
 */
public record ScalarEffectLogEntry(
        long timeMs,
        String sourceActorId,
        String targetActorId,
        String actionId,
        String effectKind,
        double baseValue,
        double finalValue,
        boolean isCritical,
        double critMultiplier,
        String critType) implements EngineLogEntry {

    @Override
    public String type() {
        return "scalar_effect";
    }
}
