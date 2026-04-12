package xyz.game.enginev2demo.crit;

/**
 * 一次 active（execution）的前置暴击判定结果。
 * <p>
 * 同次 active 派生出的 source 侧所有可暴击数值效果复用此结果。
 *
 * @param resolved      是否已经做过判定
 * @param isCritical    本次是否暴击
 * @param critMultiplier 暴击倍率（非暴击时为 1.0）
 * @param critType      命中的 critType 标签（可为 null）
 */
public record ExecutionCritResult(
        boolean resolved,
        boolean isCritical,
        double critMultiplier,
        String critType) {

    /** 占位——尚未做过判定。 */
    public static final ExecutionCritResult UNRESOLVED =
            new ExecutionCritResult(false, false, 1.0, null);

    /** 判定结果为不暴击。 */
    public static ExecutionCritResult noCrit() {
        return new ExecutionCritResult(true, false, 1.0, null);
    }

    /** 判定结果为暴击。 */
    public static ExecutionCritResult crit(double multiplier, String critType) {
        return new ExecutionCritResult(true, true, multiplier, critType);
    }
}
