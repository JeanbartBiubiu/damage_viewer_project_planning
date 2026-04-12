package xyz.game.enginev2demo.shield;

import xyz.game.enginev2demo.api.EngineLogEntry;

/**
 * 护盾授予日志条目，记录护盾量的变刻过程。
 */
public record ShieldLogEntry(
        long timeMs,
        String actorId,
        String label,
        double requestedAmount,
        double shieldBefore,
        double shieldAfter) implements EngineLogEntry {

    @Override
    public String type() {
        return "shield";
    }
}
