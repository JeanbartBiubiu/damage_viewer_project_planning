package xyz.game.enginev2demo.runtime;

/**
 * 计数器作用域。
 */
public enum CounterScope {
    /** 角色级计数器，状态挂在 ActorRuntime 上。 */
    ACTOR,
    /** 对级计数器，状态挂在 source → target 的 PairRuntimeState 上。 */
    PAIR
}
