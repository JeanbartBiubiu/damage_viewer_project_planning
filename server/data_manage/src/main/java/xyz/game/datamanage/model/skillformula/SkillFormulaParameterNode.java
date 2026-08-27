package xyz.game.datamanage.model.skillformula;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Set;

public record SkillFormulaParameterNode(
    SkillFormulaNodeType nodeType,
    String parameterKey,
    @JsonIgnore Set<String> foreignFields
) implements SkillFormulaExpressionNode {

    public SkillFormulaParameterNode {
        if (nodeType == null) {
            nodeType = SkillFormulaNodeType.PARAMETER;
        }
        parameterKey = parameterKey == null ? null : parameterKey.trim();
        foreignFields = SkillFormulaForeignFieldCapture.normalize(foreignFields);
    }

    public SkillFormulaParameterNode(String parameterKey) {
        this(SkillFormulaNodeType.PARAMETER, parameterKey, Set.of());
    }

    @JsonCreator
    static SkillFormulaParameterNode fromJson(
        @JsonProperty("nodeType") SkillFormulaNodeType nodeType,
        @JsonProperty("parameterKey") String parameterKey,
        @JsonProperty("operation") JsonNode operation,
        @JsonProperty("operands") JsonNode operands,
        @JsonProperty("attributeOwner") JsonNode attributeOwner,
        @JsonProperty("attributeKey") JsonNode attributeKey,
        @JsonProperty("attributeValueKind") JsonNode attributeValueKind
    ) {
        return new SkillFormulaParameterNode(
            nodeType,
            parameterKey,
            SkillFormulaForeignFieldCapture.capture(
                "operation", operation,
                "operands", operands,
                "attributeOwner", attributeOwner,
                "attributeKey", attributeKey,
                "attributeValueKind", attributeValueKind
            )
        );
    }
}
