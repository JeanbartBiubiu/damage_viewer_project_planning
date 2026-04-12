package xyz.game.enginev2demo.crit;

import java.util.Objects;

/**
 * 暴击规则模板——每个 critType 对应一条规则。
 *
 * @param critType              暴击类型标签（字符串）
 * @param enabled               是否启用
 * @param strategyKind          判定策略类型
 * @param multiplierFormulaId   倍率公式 ID（必须存在于 FormulaCatalog）
 */
public record CritRuleTemplate(
        String critType,
        boolean enabled,
        CritStrategyKind strategyKind,
        String multiplierFormulaId) {

    public CritRuleTemplate {
        Objects.requireNonNull(critType, "critType");
        Objects.requireNonNull(strategyKind, "strategyKind");
        Objects.requireNonNull(multiplierFormulaId, "multiplierFormulaId");
    }
}
