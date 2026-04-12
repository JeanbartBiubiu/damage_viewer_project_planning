package xyz.game.enginev2demo.crit;

/**
 * 通用数值求值结果，包含暴击信息。
 *
 * @param baseValue      公式求值得到的基础值
 * @param finalValue     应用暴击后的最终值
 * @param isCritical     是否暴击
 * @param critMultiplier 暴击倍率
 * @param critType       命中的 critType 标签
 */
public record ResolvedScalar(
        double baseValue,
        double finalValue,
        boolean isCritical,
        double critMultiplier,
        String critType) {

    /** 创建一个没有暴击的结果。 */
    public static ResolvedScalar plain(double value) {
        return new ResolvedScalar(value, value, false, 1.0, null);
    }
}
