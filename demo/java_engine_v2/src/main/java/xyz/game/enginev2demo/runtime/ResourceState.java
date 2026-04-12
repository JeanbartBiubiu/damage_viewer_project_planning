package xyz.game.enginev2demo.runtime;

/**
 * 资源运行时状态（如 mana），带上限保护和下限保护。
 */
public final class ResourceState {

    private final String resourceId;
    private final double max;
    private double current;

    public ResourceState(String resourceId, double max, double current) {
        this.resourceId = resourceId;
        this.max = Math.max(0.0, max);
        this.current = Math.max(0.0, Math.min(this.max, current));
    }

    public String resourceId() {
        return resourceId;
    }

    public double max() {
        return max;
    }

    public double current() {
        return current;
    }

    public void spend(double amount) {
        current = Math.max(0.0, current - Math.max(0.0, amount));
    }
}
