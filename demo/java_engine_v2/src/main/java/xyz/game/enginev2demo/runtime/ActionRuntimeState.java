package xyz.game.enginev2demo.runtime;

import java.util.ArrayList;
import java.util.List;

/**
 * 单个动作的运行时状态——统一节奏状态容器。
 * <p>
 * 非充能动作：{@code maxCharges=1, currentCharges=1, rechargeEndTimesMs=[]}。
 * 充能动作：消耗层数后按冷却公式开启回充，{@code rechargeEndTimesMs} 按升序保存未来每层的完成时刻。
 */
public final class ActionRuntimeState {

    private final String actionId;
    private long readyAtMs;
    private boolean enabled;
    private final int maxCharges;
    private int currentCharges;
    private final List<Long> rechargeEndTimesMs;

    public ActionRuntimeState(String actionId, long readyAtMs, boolean enabled) {
        this(actionId, readyAtMs, enabled, 1, 1);
    }

    public ActionRuntimeState(String actionId, long readyAtMs, boolean enabled, int maxCharges, int currentCharges) {
        this.actionId = actionId;
        this.readyAtMs = readyAtMs;
        this.enabled = enabled;
        this.maxCharges = maxCharges;
        this.currentCharges = currentCharges;
        this.rechargeEndTimesMs = new ArrayList<>();
    }

    public String actionId() {
        return actionId;
    }

    public long readyAtMs() {
        return readyAtMs;
    }

    public void setReadyAtMs(long readyAtMs) {
        this.readyAtMs = readyAtMs;
    }

    public boolean enabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public int maxCharges() {
        return maxCharges;
    }

    public int currentCharges() {
        return currentCharges;
    }

    public void setCurrentCharges(int currentCharges) {
        this.currentCharges = currentCharges;
    }

    /** 按升序保存未来每一层正在恢复的充能完成时刻（可变列表）。 */
    public List<Long> rechargeEndTimesMs() {
        return rechargeEndTimesMs;
    }
}
