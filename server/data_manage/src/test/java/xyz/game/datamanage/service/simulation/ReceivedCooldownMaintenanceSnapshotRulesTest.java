package xyz.game.datamanage.service.simulation;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.error.ApiException;

class ReceivedCooldownMaintenanceSnapshotRulesTest {
    static final String MAINTENANCE = """
        {"skill":{"gameId":"scenario","skillKey":"defense_spell","maxLevel":5,"status":"ENABLED"},
         "parameters":[{"gameId":"scenario","skillKey":"defense_spell","parameterKey":"reduction","valueType":"INTEGER",
           "valueMode":"FIXED","fixedValue":750,"levelValues":null}],
         "effects":[{"effectKey":"reduce","lifecycle":null,"results":[{"resultKey":"remaining","resultType":"COOLDOWN_CHANGE",
          "target":"SOURCE","valueRule":{"value":{"kind":"PARAMETER","parameterKey":"reduction"},"fixedMultiplier":1,"fixedMinValue":null,"fixedMaxValue":null},
          "lifecycleBehavior":null,"spellShieldBlockScope":null,
          "detail":{"operation":"REDUCE","affectedSkillScope":{"mode":"SKILLS","skillKeys":["defense_spell"],"skillCategoryKeys":[]}}}]}],
         "triggerRules":[{"ruleKey":"received","eventSource":{"eventType":"BASIC_ATTACK_RECEIVED","detail":{}},"conditionGroups":[],
          "oncePerUse":null,"perTargetCooldown":null,"maxTriggersPerProcess":null,
          "actions":[{"actionKey":"reduce","actionType":"EXECUTE_EFFECT","targetContext":"CURRENT_TARGET","detail":{"effectKey":"reduce"},"runtimeInputBindings":[],"resultModifiers":[]}]}]}
        """;

    private static ObjectNode configuration() { return (ObjectNode) AggregateJson.tree(MAINTENANCE); }
    private static Set<String> dormant(ObjectNode configuration, boolean received, boolean initial) {
        return ReceivedCooldownMaintenanceSnapshotRules.dormant(configuration, 5, 18, "skillConfigurations[1]", received, initial);
    }

    @Test void aKnownAbsentProducerOrOwnInitialProvesDormancyButBothActualConditionsReject() {
        assertEquals(Set.of("received"), dormant(configuration(), false, true));
        assertEquals(Set.of("received"), dormant(configuration(), true, false));
        assertEquals(Set.of("received"), dormant(configuration(), false, false));
        assertThrows(ApiException.class, () -> dormant(configuration(), true, true));
    }

    @Test void fixedAndAllDeclaredLevelsAreCheckedBeforeTheDormancyProof() {
        ObjectNode config = configuration(), parameter = (ObjectNode) config.path("parameters").get(0);
        parameter.put("valueMode", "SKILL_LEVEL").putNull("fixedValue");
        parameter.set("levelValues", AggregateJson.tree("{\"1\":750,\"2\":750,\"3\":750,\"4\":750,\"5\":750}"));
        assertEquals(Set.of("received"), dormant(config, false, true));
        ((ObjectNode) parameter.path("levelValues")).put("1", 749);
        assertThrows(ApiException.class, () -> dormant(config, false, true));
        ((ObjectNode) parameter.path("levelValues")).put("1", 750).remove("5");
        assertThrows(ApiException.class, () -> dormant(config, false, true));
        parameter.put("valueMode", "RUNTIME_INPUT").putNull("levelValues");
        assertThrows(ApiException.class, () -> dormant(config, false, true));
    }

    @ParameterizedTest @ValueSource(strings = {"wrong_scope", "target", "extra_result", "extra_action", "condition", "throttle", "binding", "formula", "mixed_missing_effect", "missing_parameter"})
    void malformedOrMixedProgramsCannotHideBehindAnAbsentProducer(String mutation) {
        ObjectNode config = configuration(), rule = (ObjectNode) config.path("triggerRules").get(0);
        ObjectNode effect = (ObjectNode) config.path("effects").get(0), result = (ObjectNode) effect.path("results").get(0);
        ObjectNode action = (ObjectNode) rule.path("actions").get(0);
        switch (mutation) {
            case "wrong_scope" -> ((ObjectNode) result.path("detail").path("affectedSkillScope")).set("skillKeys", AggregateJson.tree("[\"another_spell\"]"));
            case "target" -> result.put("target", "TARGET");
            case "extra_result" -> ((com.fasterxml.jackson.databind.node.ArrayNode) effect.path("results")).add(result.deepCopy());
            case "extra_action" -> ((com.fasterxml.jackson.databind.node.ArrayNode) rule.path("actions")).add(action.deepCopy());
            case "condition" -> rule.set("conditionGroups", AggregateJson.tree("[{\"conditions\":[]}]"));
            case "throttle" -> rule.set("perTargetCooldown", AggregateJson.tree("{\"durationValue\":{\"kind\":\"FIXED\",\"value\":10}}"));
            case "binding" -> action.set("runtimeInputBindings", AggregateJson.tree("[{}]"));
            case "formula" -> ((ObjectNode) result.path("valueRule")).set("value", AggregateJson.tree("{\"kind\":\"FORMULA\",\"formulaKey\":\"hidden\"}"));
            case "mixed_missing_effect" -> {
                var missing = action.deepCopy(); ((ObjectNode) missing.path("detail")).put("effectKey", "missing");
                ((com.fasterxml.jackson.databind.node.ArrayNode) rule.path("actions")).add(missing);
            }
            case "missing_parameter" -> ((ObjectNode) result.path("valueRule")).set("value", AggregateJson.tree("{\"kind\":\"PARAMETER\",\"parameterKey\":\"missing\"}"));
            default -> fail(mutation);
        }
        assertThrows(ApiException.class, () -> dormant(config, false, true), mutation);
    }

    @Test void aDifferentReceivedMechanicIsPreservedAndWrongLevelCannotBeDormant() {
        ObjectNode config = configuration();
        ((ObjectNode) config.path("effects").get(0).path("results").get(0).path("detail")).put("operation", "RESET");
        assertEquals(Set.of(), dormant(config, false, true));
        assertThrows(ApiException.class, () -> ReceivedCooldownMaintenanceSnapshotRules.dormant(configuration(), 0, 18, "config", false, false));
        assertThrows(ApiException.class, () -> ReceivedCooldownMaintenanceSnapshotRules.dormant(configuration(), null, 18, "config", false, false));
    }

    @Test void anUnclassifiedMissingReferenceRemainsForTheOriginalExecutionClosure() {
        ObjectNode config = configuration();
        ((ObjectNode) config.path("triggerRules").get(0).path("actions").get(0).path("detail")).put("effectKey", "missing");
        assertEquals(Set.of(), dormant(config, false, false));
    }
}
