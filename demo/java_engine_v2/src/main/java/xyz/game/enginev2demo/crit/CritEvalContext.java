package xyz.game.enginev2demo.crit;

import xyz.game.enginev2demo.runtime.ActorRuntime;
import xyz.game.enginev2demo.runtime.RuntimeState;

/**
 * 暴击策略评估时的上下文。
 *
 * @param state       当前运行时状态
 * @param source      动作来源 actor
 * @param target      动作目标 actor
 * @param actionId    当前动作 ID
 * @param critType    匹配到的 critType 标签
 * @param critChance  从 source actor resolved attr 读到的暴击几率
 */
public record CritEvalContext(
        RuntimeState state,
        ActorRuntime source,
        ActorRuntime target,
        String actionId,
        String critType,
        double critChance) {
}
