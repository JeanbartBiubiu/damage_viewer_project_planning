package xyz.game.enginev2demo.action;

import xyz.game.enginev2demo.api.EngineLogEntry;

/**
 * 动作施放日志条目，记录一次成功施放的动作（伤害结算前）。
 */
public record ActionLogEntry(
        long timeMs,
        String sourceActorId,
        String targetActorId,
        String actionId,
        String label) implements EngineLogEntry {

    @Override
    public String type() {
        return "action";
    }
}
