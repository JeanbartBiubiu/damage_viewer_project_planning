package xyz.game.enginev2demo.api;

/**
 * 模拟停止条件。当已处理事件数达到 maxEvents 时强制停止。
 *
 * @param maxEvents 最大可处理事件数，默认 1024
 */
public record StopCondition(long maxEvents) {

    public StopCondition {
        if (maxEvents < 0) {
            throw new IllegalArgumentException("maxEvents must be >= 0");
        }
    }

    public static StopCondition defaultStop() {
        return new StopCondition(1024);
    }
}
