package xyz.game.datamanage.support.formula;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

public final class SkillFormulaFixtures {
    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;
    private SkillFormulaFixtures() {}
    public static ObjectNode definition(JsonNode expression) {
        ObjectNode definition = JSON.objectNode(); definition.putArray("inputs");
        definition.putArray("stages").addObject().put("key", "output").put("name", "原技能公式输出").set("expression", expression);
        return definition.put("outputStageKey", "output");
    }
    public static ObjectNode constant(String value) { return definition(JSON.objectNode().put("op", "const").put("value", value)); }
    public static ObjectNode parameter(String skill, String key) {
        return input(JSON.objectNode().put("kind", "parameter").put("skillKey", skill).put("parameterKey", key));
    }
    public static ObjectNode attribute(String object, String key, String kind) {
        return input(JSON.objectNode().put("kind", "attribute").put("object", object).put("attributeKey", key)
            .put("valueKind", kind).put("view", "current_frame"));
    }
    public static ObjectNode input(JsonNode binding) {
        ObjectNode definition = definition(JSON.objectNode().put("op", "read").put("inputKey", "input_0"));
        ((com.fasterxml.jackson.databind.node.ArrayNode) definition.path("inputs")).addObject().put("key", "input_0").set("binding", binding);
        return definition;
    }
}
