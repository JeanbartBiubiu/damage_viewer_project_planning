package xyz.game.enginev2demo.crit;

/**
 * 暴击判定策略类型。
 * <p>
 * 第一版仅支持 {@code DETERMINISTIC_COUNTER}，但枚举设计为可扩展。
 */
public enum CritStrategyKind {
    /** 确定性计数器——每 N 次可暴击 active 必暴击一次。 */
    DETERMINISTIC_COUNTER,
    /** 预留：基于公式的随机判定。 */
    RANDOM_FORMULA
}
