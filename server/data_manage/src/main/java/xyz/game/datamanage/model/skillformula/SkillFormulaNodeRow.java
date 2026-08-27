package xyz.game.datamanage.model.skillformula;

import java.util.UUID;

public record SkillFormulaNodeRow(
    String gameId,
    String skillKey,
    String formulaKey,
    UUID nodeId,
    UUID parentNodeId,
    Short childOrder,
    SkillFormulaNodeType nodeType,
    SkillFormulaOperation operation,
    String parameterKey,
    AttributeOwner attributeOwner,
    String attributeKey,
    AttributeValueKind attributeValueKind
) {
}
