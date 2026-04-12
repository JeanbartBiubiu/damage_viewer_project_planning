package xyz.game.enginev2demo.runtime;

/**
 * 控制效果时间窗口记录，用于历史窗口聚合计算。
 *
 * @param startAtMs 控制效果开始时间
 * @param endAtMs   控制效果结束时间
 */
public record ControlRecord(
        long startAtMs,
        long endAtMs) {
}
