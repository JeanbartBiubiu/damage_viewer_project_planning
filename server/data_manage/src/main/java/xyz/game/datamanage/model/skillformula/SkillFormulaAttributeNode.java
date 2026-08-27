package xyz.game.datamanage.model.skillformula;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Set;

public record SkillFormulaAttributeNode(
    SkillFormulaNodeType nodeType,
    AttributeOwner attributeOwner,
    String attributeKey,
    AttributeValueKind attributeValueKind,
    @JsonIgnore Set<String> foreignFields
) implements SkillFormulaExpressionNode {

    public SkillFormulaAttributeNode {
        if (nodeType == null) {
            nodeType = SkillFormulaNodeType.ATTRIBUTE;
        }
        attributeKey = attributeKey == null ? null : attributeKey.trim();
        foreignFields = SkillFormulaForeignFieldCapture.normalize(foreignFields);
    }

    public SkillFormulaAttributeNode(
        AttributeOwner attributeOwner,
        String attributeKey,
        AttributeValueKind attributeValueKind
    ) {
        this(SkillFormulaNodeType.ATTRIBUTE, attributeOwner, attributeKey, attributeValueKind, Set.of());
    }

    @JsonCreator
    static SkillFormulaAttributeNode fromJson(
        @JsonProperty("nodeType") SkillFormulaNodeType nodeType,
        @JsonProperty("attributeOwner") AttributeOwner attributeOwner,
        @JsonProperty("attributeKey") String attributeKey,
        @JsonProperty("attributeValueKind") AttributeValueKind attributeValueKind,
        @JsonProperty("operation") JsonNode operation,
        @JsonProperty("operands") JsonNode operands,
        @JsonProperty("parameterKey") JsonNode parameterKey
    ) {
        return new SkillFormulaAttributeNode(
            nodeType,
            attributeOwner,
            attributeKey,
            attributeValueKind,
            SkillFormulaForeignFieldCapture.capture(
                "operation", operation,
                "operands", operands,
                "parameterKey", parameterKey
            )
        );
    }
}
