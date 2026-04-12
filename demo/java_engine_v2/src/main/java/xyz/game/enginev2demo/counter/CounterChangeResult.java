package xyz.game.enginev2demo.counter;

/**
 * 计数器修改结果。
 *
 * @param value              修改后的当前值
 * @param thresholdTriggered 是否在本次修改中达到或超过了阈值
 */
public record CounterChangeResult(
        int value,
        boolean thresholdTriggered) {
}
