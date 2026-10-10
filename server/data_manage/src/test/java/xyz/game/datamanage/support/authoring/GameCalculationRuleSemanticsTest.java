package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.support.authoring.GameCalculationRuleSemantics.Attribute;

class GameCalculationRuleSemanticsTest {
    private static final Map<String, Attribute> ATTRIBUTES = Map.of(
        "chance", new Attribute("DECIMAL", "ENABLED"), "velocity", new Attribute("DECIMAL", "ENABLED"),
        "growth", new Attribute("INTEGER", "ENABLED"), "factor", new Attribute("DECIMAL", "ENABLED"),
        "other", new Attribute("DECIMAL", "ENABLED"), "hp", new Attribute("INTEGER", "ENABLED"),
        "max_hp", new Attribute("INTEGER", "ENABLED"));

    @Test void explicitNullAndZeroRemainDifferentAndNoDefaultRuleIsInvented() {
        ObjectNode empty = configuration();
        empty.putNull("criticalMultiplierMin");
        empty.putArray("attributeDerivations");
        assertNull(GameCalculationRuleSemantics.validate(empty, ATTRIBUTES));
        assertTrue(empty.path("criticalMultiplierMin").isNull());
        empty.put("criticalMultiplierMin", 0);
        assertNull(GameCalculationRuleSemantics.validate(empty, ATTRIBUTES));
        assertEquals(0, empty.path("criticalMultiplierMin").intValue());
        assertTrue(empty.path("attributeDerivations").isEmpty());
    }

    @Test void realDirectoryAllowsBothNumericTypesAndKeepsAuthorDecimalStrings() {
        ObjectNode configuration = configuration();
        String before = configuration.toString();
        assertNull(GameCalculationRuleSemantics.validate(configuration, ATTRIBUTES));
        assertEquals(before, configuration.toString());
        assertEquals("0.1234500", configuration.at("/attributeDerivations/0/formula/stages/1/expression/value").textValue());
        assertEquals(4, GameCalculationRuleSemantics.dependencies(configuration).size());
        assertTrue(GameCalculationRuleSemantics.dependencies(configuration).containsKey("other"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"target", "owner", "event_source", "event_target"})
    void onlyTheDerivationOwnerSourceObjectIsAuthorized(String object) {
        ObjectNode configuration = configuration();
        binding(configuration).put("object", object);
        assertIssue(configuration, "/configuration/attributeDerivations/0/formula/inputs/0/binding", "FORMULA_UNKNOWN_BINDING");
    }

    @ParameterizedTest
    @ValueSource(strings = {"CURRENT", "MAX", "MISSING", "CURRENT_RATIO", "MISSING_RATIO"})
    void unsupportedOrdinaryValueViewsAreNotAuthorized(String valueKind) {
        ObjectNode configuration = configuration();
        binding(configuration).put("valueKind", valueKind);
        assertIssue(configuration, "/configuration/attributeDerivations/0/formula/inputs/0/binding", "FORMULA_UNKNOWN_BINDING");
    }

    @Test void parameterContextEventAndUnknownDirectoryBindingsAreRejectedEvenWhenUnused() {
        for (String binding : new String[] {
            "{\"kind\":\"parameter\",\"skillKey\":\"skill\",\"parameterKey\":\"amount\"}",
            "{\"kind\":\"context\",\"contextKey\":\"charge_duration\"}",
            "{\"kind\":\"attribute\",\"object\":\"source\",\"attributeKey\":\"outside_game\",\"valueKind\":\"BASE\",\"view\":\"current_frame\"}",
            "{\"kind\":\"attribute\",\"object\":\"source\",\"attributeKey\":\"growth\",\"valueKind\":\"TOTAL\",\"view\":\"event_snapshot\"}"}) {
            ObjectNode configuration = configuration();
            ((ObjectNode) configuration.at("/attributeDerivations/0/formula/inputs/0")).set("binding", AggregateJson.tree(binding));
            assertIssue(configuration, "/configuration/attributeDerivations/0/formula/inputs/0/binding", "FORMULA_UNKNOWN_BINDING");
        }
    }

    @Test void selfAndOtherOutputsMayOnlyReadFrozenBaseAndNeverDerivedBonusOrTotal() {
        for (String output : new String[] {"velocity", "other"}) {
            for (String kind : new String[] {"BONUS", "TOTAL", "BASE"}) {
                ObjectNode configuration = configuration();
                var rules = (com.fasterxml.jackson.databind.node.ArrayNode) configuration.path("attributeDerivations");
                ObjectNode second = rule().deepCopy();
                second.put("ruleKey", "second").put("attributeKey", "other");
                second.set("formula", constant());
                rules.add(second);
                binding(configuration).put("attributeKey", output).put("valueKind", kind);
                if (kind.equals("BASE")) assertNull(GameCalculationRuleSemantics.validate(configuration, ATTRIBUTES));
                else assertIssue(configuration, "/configuration/attributeDerivations/0/formula/inputs/0/binding", "FORMULA_UNKNOWN_BINDING");
            }
        }
    }

    @Test void onlyTheExistingLifeCoreSlotIsReservedAndOtherNamesAreOrdinaryAttributes() {
        ObjectNode configuration = configuration();
        rule(configuration).put("attributeKey", "hp");
        assertIssue(configuration, "/configuration/attributeDerivations/0/attributeKey", "LIFE_OUTPUT_FORBIDDEN");
        rule(configuration).put("attributeKey", "max_hp");
        assertNull(GameCalculationRuleSemantics.validate(configuration, ATTRIBUTES));
    }

    @Test void lifeActivationRejectsItsActualCollectionItemWithoutTreatingOtherNamesAsLife() {
        ObjectNode configuration = configuration();
        rule(configuration).putArray("activationAttributeKeys").add("growth").add("hp");
        assertIssue(configuration, "/configuration/attributeDerivations/0/activationAttributeKeys/1", "LIFE_ACTIVATION_FORBIDDEN");
        rule(configuration).putArray("activationAttributeKeys").add("hp").add("growth");
        assertIssue(configuration, "/configuration/attributeDerivations/0/activationAttributeKeys/0", "LIFE_ACTIVATION_FORBIDDEN");
        rule(configuration).putArray("activationAttributeKeys").add("max_hp").add("growth");
        assertNull(GameCalculationRuleSemantics.validate(configuration, ATTRIBUTES));
    }

    @Test void duplicatesPoliciesActivationAndCapacityAreStrict() {
        ObjectNode configuration = configuration();
        var rules = (com.fasterxml.jackson.databind.node.ArrayNode) configuration.path("attributeDerivations");
        rules.add(rule().deepCopy());
        assertIssue(configuration, "/configuration/attributeDerivations/1/ruleKey", "DUPLICATE_KEY");
        ((ObjectNode) rules.get(1)).put("ruleKey", "second");
        assertIssue(configuration, "/configuration/attributeDerivations/1/attributeKey", "DUPLICATE_OUTPUT");
        rules.remove(1);
        rule(configuration).putNull("valuePolicy");
        assertIssue(configuration, "/configuration/attributeDerivations/0/valuePolicy", "ENUM_INVALID");
        rule(configuration).put("valuePolicy", "multiply");
        rule(configuration).putArray("activationAttributeKeys");
        assertIssue(configuration, "/configuration/attributeDerivations/0/activationAttributeKeys", "NON_EMPTY_ARRAY_REQUIRED");
        rule(configuration).putArray("activationAttributeKeys").add("growth").add("growth");
        assertIssue(configuration, "/configuration/attributeDerivations/0/activationAttributeKeys/1", "DUPLICATE_KEY");
        rules.removeAll();
        for (int i = 0; i < 5; i++) rules.add(rule());
        assertIssue(configuration, "/configuration/attributeDerivations", "LIMIT");
    }

    @Test void unknownFieldsAndMissingFieldsKeepExactPointersIncludingSharedFormulaErrors() {
        ObjectNode configuration = configuration();
        configuration.put("/~", 1);
        configuration.remove("attackSpeedAttributeKey");
        assertIssue(configuration, "/configuration/~1~0", "UNKNOWN_FIELD");
        configuration.remove("/~");
        assertIssue(configuration, "/configuration/attackSpeedAttributeKey", "REQUIRED");
        configuration = configuration();
        ((ObjectNode) configuration.at("/attributeDerivations/0/formula/stages/0/expression")).put("inputKey", "missing");
        assertIssue(configuration, "/configuration/attributeDerivations/0/formula/stages/0/expression/inputKey", "FORMULA_UNKNOWN_INPUT");
    }

    @Test void usageOutputActivationAndEveryDeclaredInputRequireEnabledDirectoryEntries() {
        for (String key : new String[] {"chance", "velocity", "growth", "other"}) {
            Map<String, Attribute> attributes = new LinkedHashMap<>(ATTRIBUTES);
            attributes.put(key, new Attribute("DECIMAL", "DISABLED"));
            var issue = GameCalculationRuleSemantics.validate(configuration(), attributes);
            assertNotNull(issue, key);
            assertTrue(issue.code().equals("REFERENCE_DISABLED") || issue.code().equals("FORMULA_UNKNOWN_BINDING"));
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"-1", "1e999", "\"1\"", "true"})
    void multiplierMinimumRejectsNegativeOverflowAndCoercedValues(String value) {
        ObjectNode configuration = configuration();
        configuration.set("criticalMultiplierMin", AggregateJson.tree(value));
        assertNotNull(GameCalculationRuleSemantics.validate(configuration, ATTRIBUTES));
    }

    static ObjectNode configuration() {
        ObjectNode configuration = (ObjectNode) AggregateJson.tree("""
            {"criticalChanceAttributeKey":"chance","criticalMultiplierMin":1,"attackSpeedAttributeKey":"velocity","attributeDerivations":[]}
            """);
        configuration.putArray("attributeDerivations").add(rule());
        return configuration;
    }

    private static ObjectNode rule() {
        ObjectNode rule = (ObjectNode) AggregateJson.tree("""
            {"ruleKey":"velocity_rule","attributeKey":"velocity","valuePolicy":"set","activationAttributeKeys":["growth"],"formula":null}
            """);
        rule.set("formula", AggregateJson.tree("""
            {"inputs":[{"key":"growth","binding":{"kind":"attribute","object":"source","attributeKey":"growth","valueKind":"TOTAL","view":"current_frame"}},
               {"key":"unused","binding":{"kind":"attribute","object":"source","attributeKey":"other","valueKind":"BASE","view":"current_frame"}}],
             "stages":[{"key":"result","name":"结果","expression":{"op":"read","inputKey":"growth"}},
               {"key":"unused","name":"未使用","expression":{"op":"const","value":"0.1234500"}}],"outputStageKey":"result"}
            """));
        return rule;
    }

    private static JsonNode constant() { return AggregateJson.tree("{\"inputs\":[],\"stages\":[{\"key\":\"result\",\"name\":\"结果\",\"expression\":{\"op\":\"const\",\"value\":\"0\"}}],\"outputStageKey\":\"result\"}"); }
    private static ObjectNode rule(ObjectNode configuration) { return (ObjectNode) configuration.path("attributeDerivations").get(0); }
    private static ObjectNode binding(ObjectNode configuration) { return (ObjectNode) configuration.at("/attributeDerivations/0/formula/inputs/0/binding"); }
    private static void assertIssue(ObjectNode configuration, String field, String code) {
        var issue = GameCalculationRuleSemantics.validate(configuration, ATTRIBUTES);
        assertNotNull(issue);
        assertEquals(field, issue.field());
        assertEquals(code, issue.code());
    }

}
