package xyz.game.datamanage.model.damagetype;

import java.math.BigDecimal;

public record DamageTypeFormulaFixedNode(
    DamageTypeFormulaNodeType nodeType,
    BigDecimal value
) implements DamageTypeFormulaNode {

    public DamageTypeFormulaFixedNode {
        if (nodeType == null) {
            nodeType = DamageTypeFormulaNodeType.FIXED;
        }
    }

    public DamageTypeFormulaFixedNode(BigDecimal value) {
        this(DamageTypeFormulaNodeType.FIXED, value);
    }
}
