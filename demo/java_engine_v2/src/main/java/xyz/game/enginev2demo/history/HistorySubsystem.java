package xyz.game.enginev2demo.history;

import xyz.game.enginev2demo.runtime.ActorRuntime;

/**
 * 历史记录子系统——提供向 {@link xyz.game.enginev2demo.runtime.HistoryWindowState}
 * 写入伤害和控制记录的龨口。
 */
public final class HistorySubsystem {

    public void recordDamageTaken(ActorRuntime actorRuntime, long timeMs, double amount) {
        actorRuntime.history().recordDamage(timeMs, amount);
    }

    public void recordControlWindow(ActorRuntime actorRuntime, long startAtMs, long endAtMs) {
        actorRuntime.history().recordControl(startAtMs, endAtMs);
    }
}
