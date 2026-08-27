package xyz.game.datamanage.model.skillformula;

public record SkillFormulaAttributeRef(
    AttributeOwner attributeOwner,
    String attributeKey,
    AttributeValueKind attributeValueKind
) {
}
