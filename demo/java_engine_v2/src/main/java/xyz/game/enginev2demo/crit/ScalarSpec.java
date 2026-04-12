package xyz.game.enginev2demo.crit;

/**
 * 可暴击数值字段描述——传入 ScalarResolutionService 用于决定是否对该值应用暴击。
 *
 * @param formulaId         公式 ID
 * @param allowCrit         该字段是否允许暴击
 * @param critTypeOverride  效果级 critType 覆盖（可为 null，则继承 action 级）
 */
public record ScalarSpec(
        String formulaId,
        boolean allowCrit,
        String critTypeOverride) {

    public ScalarSpec(String formulaId) {
        this(formulaId, false, null);
    }
}
