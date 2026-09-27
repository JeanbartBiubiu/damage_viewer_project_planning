package xyz.game.datamanage.model.damagetype;

public sealed interface DamageTypeFormulaNode
    permits DamageTypeFormulaOperationNode,
        DamageTypeFormulaFixedNode,
        DamageTypeFormulaAttributeNode,
        DamageTypeFormulaStageResultNode {

    DamageTypeFormulaNodeType nodeType();
}
