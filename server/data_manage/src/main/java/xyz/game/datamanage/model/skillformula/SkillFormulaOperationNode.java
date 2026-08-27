package xyz.game.datamanage.model.skillformula;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Set;

public record SkillFormulaOperationNode(
    SkillFormulaNodeType nodeType,
    SkillFormulaOperation operation,
    List<SkillFormulaExpressionNode> operands,
    @JsonIgnore Set<String> foreignFields
) implements SkillFormulaExpressionNode {

    public SkillFormulaOperationNode {
        if (nodeType == null) {
            nodeType = SkillFormulaNodeType.OPERATION;
        }
        foreignFields = SkillFormulaForeignFieldCapture.normalize(foreignFields);
    }

    public SkillFormulaOperationNode(
        SkillFormulaOperation operation,
        List<SkillFormulaExpressionNode> operands
    ) {
        this(SkillFormulaNodeType.OPERATION, operation, operands, Set.of());
    }

    @JsonCreator
    static SkillFormulaOperationNode fromJson(
        @JsonProperty("nodeType") SkillFormulaNodeType nodeType,
        @JsonProperty("operation") SkillFormulaOperation operation,
        @JsonProperty("operands") List<SkillFormulaExpressionNode> operands,
        @JsonProperty("parameterKey") JsonNode parameterKey,
        @JsonProperty("attributeOwner") JsonNode attributeOwner,
        @JsonProperty("attributeKey") JsonNode attributeKey,
        @JsonProperty("attributeValueKind") JsonNode attributeValueKind
    ) {
        return new SkillFormulaOperationNode(
            nodeType,
            operation,
            operands,
            SkillFormulaForeignFieldCapture.capture(
                "parameterKey", parameterKey,
                "attributeOwner", attributeOwner,
                "attributeKey", attributeKey,
                "attributeValueKind", attributeValueKind
            )
        );
    }
}
