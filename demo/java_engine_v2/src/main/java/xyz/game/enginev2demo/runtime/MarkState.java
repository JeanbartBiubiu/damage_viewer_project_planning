package xyz.game.enginev2demo.runtime;

/**
 * 标记运行时状态——有向可消耗印记，存储在 PairRuntimeState 上。
 * <p>
 * 过期采用懒检查：读取时检查 expireAtMs，已过期则移除。
 */
public final class MarkState {

    private final String markId;
    private final String sourceActorId;
    private final String targetActorId;
    private final long appliedAtMs;
    private long expireAtMs;
    private boolean consumable;
    private boolean active;

    public MarkState(
            String markId,
            String sourceActorId,
            String targetActorId,
            long appliedAtMs,
            long expireAtMs,
            boolean consumable,
            boolean active) {
        this.markId = markId;
        this.sourceActorId = sourceActorId;
        this.targetActorId = targetActorId;
        this.appliedAtMs = appliedAtMs;
        this.expireAtMs = expireAtMs;
        this.consumable = consumable;
        this.active = active;
    }

    public String markId() {
        return markId;
    }

    public String sourceActorId() {
        return sourceActorId;
    }

    public String targetActorId() {
        return targetActorId;
    }

    public long appliedAtMs() {
        return appliedAtMs;
    }

    public long expireAtMs() {
        return expireAtMs;
    }

    public void setExpireAtMs(long expireAtMs) {
        this.expireAtMs = expireAtMs;
    }

    public boolean consumable() {
        return consumable;
    }

    public void setConsumable(boolean consumable) {
        this.consumable = consumable;
    }

    public boolean active() {
        return active;
    }

    public void setActive(boolean active) {
        this.active = active;
    }
}
