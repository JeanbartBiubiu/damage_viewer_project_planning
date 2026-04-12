package xyz.game.enginev2demo.formula;

import java.util.Objects;

/**
 * 公式定义——一个具名的公式，根节点是一棵 AST。
 *
 * @param formulaId 公式唯一标识
 * @param root      AST 根节点
 */
public record FormulaDefinition(
        String formulaId,
        FormulaNode root) {

    public FormulaDefinition {
        Objects.requireNonNull(formulaId, "formulaId");
        Objects.requireNonNull(root, "root");
    }
}
