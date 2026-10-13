package xyz.game.datamanage.support.formula;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import java.util.stream.StreamSupport;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import xyz.game.datamanage.support.formula.FormulaContractValidator.Issue;

class FormulaContractValidatorTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    @TestFactory
    Stream<DynamicTest> generatedCasesHaveExactlyTheSharedFirstIssueAndDoNotMutateInputs() throws Exception {
        JsonNode cases = cases().path("cases");
        assertTrue(cases.isArray() && !cases.isEmpty());
        return StreamSupport.stream(cases.spliterator(), false).map(sample -> DynamicTest.dynamicTest(sample.path("name").textValue(), () -> {
            JsonNode definition = sample.get("definition");
            List<JsonNode> bindings = new ArrayList<>();
            sample.path("allowedBindings").forEach(bindings::add);
            String originalDefinition = JSON.writeValueAsString(definition);
            String originalBindings = JSON.writeValueAsString(bindings);
            JsonNode expected = sample.path("expected");
            Issue expectedIssue = expected.isNull() ? null : new Issue(expected.path("code").textValue(), expected.path("path").textValue());

            assertEquals(expectedIssue, FormulaContractValidator.validate(definition, bindings));
            assertEquals(originalDefinition, JSON.writeValueAsString(definition));
            assertEquals(originalBindings, JSON.writeValueAsString(bindings));
        }));
    }

    @Test
    void schemaDigestMatchesTheGeneratedCases() throws Exception {
        assertEquals(FormulaContractSchema.SHA256, cases().path("schemaSha256").textValue());
        assertEquals(64, FormulaContractSchema.SHA256.length());
    }

    @Test
    void decimalTextRetainsItsOriginalPrecisionAndZerosAcrossJsonRoundTrip() throws Exception {
        ObjectNode definition = definition("const");
        String original = "-123456789.1234567890123456789000";
        ((ObjectNode) definition.path("stages").get(0).path("expression")).put("value", original);
        assertNull(FormulaContractValidator.validate(definition, List.of()));
        JsonNode roundTrip = JSON.readTree(JSON.writeValueAsString(definition));
        assertEquals(original, roundTrip.path("stages").get(0).path("expression").path("value").textValue());
        assertEquals(definition, roundTrip);
    }

    @Test
    void mathematicallyIntegralJsonNumbersAreValidRoundDecimals() throws Exception {
        ObjectNode definition = definition("round");
        ObjectNode expression = (ObjectNode) definition.path("stages").get(0).path("expression");
        expression.set("args", JSON.readTree("[{\"op\":\"const\",\"value\":\"1\"}]"));
        expression.set("decimals", JSON.readTree("1.0"));
        assertNull(FormulaContractValidator.validate(definition, List.of()));
    }

    @Test
    void stopsBeforeDescendingIntoAnExcessivelyDeepTree() throws Exception {
        ObjectNode definition = definition("const");
        JsonNode expression = JSON.readTree("{\"op\":\"const\",\"value\":\"0\"}");
        for (int i = 0; i < 4096; i++) {
            ObjectNode parent = JSON.createObjectNode().put("op", "floor");
            parent.putArray("args").add(expression);
            expression = parent;
        }
        ((ObjectNode) definition.path("stages").get(0)).set("expression", expression);
        assertEquals(new Issue("FORMULA_LIMIT", "/stages/0/expression" + "/args/0".repeat(32)),
            FormulaContractValidator.validate(definition, List.of()));
    }

    private static ObjectNode definition(String op) {
        ObjectNode definition = JSON.createObjectNode();
        definition.putArray("inputs");
        ObjectNode stage = definition.putArray("stages").addObject().put("key", "result").put("name", "结果");
        stage.putObject("expression").put("op", op);
        definition.put("outputStageKey", "result");
        return definition;
    }

    private static JsonNode cases() throws Exception {
        try (InputStream resource = FormulaContractValidatorTest.class.getResourceAsStream("/formula-contract/cases.generated.json")) {
            assertNotNull(resource);
            return JSON.readTree(resource);
        }
    }
}
