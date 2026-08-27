package xyz.game.datamanage.model.skillformula;

import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.fasterxml.jackson.annotation.JsonTypeInfo;
import java.util.Set;

@JsonTypeInfo(
    use = JsonTypeInfo.Id.NAME,
    include = JsonTypeInfo.As.EXISTING_PROPERTY,
    property = "nodeType",
    visible = true
)
@JsonSubTypes({
    @JsonSubTypes.Type(value = SkillFormulaOperationNode.class, name = "OPERATION"),
    @JsonSubTypes.Type(value = SkillFormulaParameterNode.class, name = "PARAMETER"),
    @JsonSubTypes.Type(value = SkillFormulaAttributeNode.class, name = "ATTRIBUTE")
})
public sealed interface SkillFormulaExpressionNode
    permits SkillFormulaOperationNode, SkillFormulaParameterNode, SkillFormulaAttributeNode {

    SkillFormulaNodeType nodeType();

    /**
     * Known formula-contract fields that belong to other node types and were present in the request.
     * Empty for nodes built by the service from persistence.
     */
    Set<String> foreignFields();
}
