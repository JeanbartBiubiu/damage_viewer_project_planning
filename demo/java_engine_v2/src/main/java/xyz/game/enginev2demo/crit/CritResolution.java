package xyz.game.enginev2demo.crit;

/**
 * 暴击策略的判定输出。
 *
 * @param isCritical 是否暴击
 * @param multiplier 暴击倍率（非暴击时会被忽略）
 */
public record CritResolution(boolean isCritical, double multiplier) {
}
