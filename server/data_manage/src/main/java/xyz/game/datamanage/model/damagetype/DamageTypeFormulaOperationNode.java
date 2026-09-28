package xyz.game.datamanage.model.damagetype;

import java.util.List;
import xyz.game.datamanage.model.skillformula.SkillFormulaOperation;

public record DamageTypeFormulaOperationNode(
    DamageTypeFormulaNodeType nodeType,
    SkillFormulaOperation operation,
    List<DamageTypeFormulaNode> operands
) implements DamageTypeFormulaNode {

    public DamageTypeFormulaOperationNode {
        if (nodeType == null) {
            nodeType = DamageTypeFormulaNodeType.OPERATION;
        }
        operands = List.copyOf(operands);
    }

    public DamageTypeFormulaOperationNode(
        SkillFormulaOperation operation,
        List<DamageTypeFormulaNode> operands
    ) {
        this(DamageTypeFormulaNodeType.OPERATION, operation, operands);
    }
}
