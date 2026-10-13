package xyz.game.datamanage.support.formula;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;

public final class DamageTypeFormulaFixtures {
    private DamageTypeFormulaFixtures() {}

    public static JsonNode definition(String value, String... attributes) {
        var result = JsonNodeFactory.instance.objectNode();
        var inputs = result.putArray("inputs");
        for (int i = 0; i < attributes.length; i++) {
            var input = inputs.addObject().put("key", "input_" + i);
            input.set("binding", DamageTypeFormulaBindings.allowed(java.util.List.of(attributes[i])).get(5));
        }
        result.putArray("stages").addObject().put("key", "result").put("name", "倍率")
            .putObject("expression").put("op", "const").put("value", value);
        result.put("outputStageKey", "result");
        return result;
    }
}
