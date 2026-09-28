package xyz.game.datamanage.model.damagetype;

import xyz.game.datamanage.model.skillformula.AttributeOwner;
import xyz.game.datamanage.model.skillformula.AttributeValueKind;

public record DamageTypeFormulaAttributeNode(
    DamageTypeFormulaNodeType nodeType,
    AttributeOwner attributeOwner,
    String attributeKey,
    AttributeValueKind attributeValueKind
) implements DamageTypeFormulaNode {

    public DamageTypeFormulaAttributeNode {
        if (nodeType == null) {
            nodeType = DamageTypeFormulaNodeType.ATTRIBUTE;
        }
    }

    public DamageTypeFormulaAttributeNode(
        AttributeOwner attributeOwner,
        String attributeKey,
        AttributeValueKind attributeValueKind
    ) {
        this(DamageTypeFormulaNodeType.ATTRIBUTE, attributeOwner, attributeKey, attributeValueKind);
    }
}
