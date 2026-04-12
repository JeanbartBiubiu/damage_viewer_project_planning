package xyz.game.enginev2demo.runtime;

/**
 * 同名状态重复挂载时的刷新策略。
 */
public enum StatusRefreshPolicy {
    /** 取新旧值中的较大值。 */
    TAKE_MAX,
    /** 直接覆盖旧值。 */
    REPLACE
}
