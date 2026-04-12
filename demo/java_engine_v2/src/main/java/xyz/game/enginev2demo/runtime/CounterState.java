package xyz.game.enginev2demo.runtime;

/**
 * 计数器运行时状态，跟踪当前值和最后更新时间。
 * 通过 {@link xyz.game.enginev2demo.counter.CounterSubsystem} 修改。
 */
public final class CounterState {

    private final String counterId;
    private int value;
    private long lastUpdatedAtMs;

    public CounterState(String counterId) {
        this.counterId = counterId;
    }

    public String counterId() {
        return counterId;
    }

    public int value() {
        return value;
    }

    public void setValue(int value) {
        this.value = value;
    }

    public long lastUpdatedAtMs() {
        return lastUpdatedAtMs;
    }

    public void setLastUpdatedAtMs(long lastUpdatedAtMs) {
        this.lastUpdatedAtMs = lastUpdatedAtMs;
    }
}
