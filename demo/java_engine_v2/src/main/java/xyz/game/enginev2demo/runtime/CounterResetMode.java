package xyz.game.enginev2demo.runtime;

/**
 * 计数器达到阈值后的重置模式。
 */
public enum CounterResetMode {
    /** 不重置，计数器保持当前值。 */
    NONE,
    /** 触发后归零。 */
    ZERO
}
