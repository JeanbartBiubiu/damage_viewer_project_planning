package xyz.game.enginev2demo.runtime;

/**
 * 伤害历史记录，用于历史窗口聚合计算。
 *
 * @param timeMs 伤害发生时间
 * @param amount 伤害量（减伤后的实际伤害）
 */
public record DamageRecord(
        long timeMs,
        double amount) {
}
