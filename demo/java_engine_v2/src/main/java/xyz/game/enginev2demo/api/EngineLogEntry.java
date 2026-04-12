package xyz.game.enginev2demo.api;

/**
 * 引擎日志条目的通用接口。
 * 每次模拟会产生一系列按时间排序的日志，具体实现包括
 * {@link xyz.game.enginev2demo.action.ActionLogEntry}（动作施放）、
 * {@link xyz.game.enginev2demo.pipeline.DamageLogEntry}（伤害结算）、
 * {@link xyz.game.enginev2demo.shield.ShieldLogEntry}（护盾授予）。
 */
public interface EngineLogEntry {

    long timeMs();

    String type();
}
