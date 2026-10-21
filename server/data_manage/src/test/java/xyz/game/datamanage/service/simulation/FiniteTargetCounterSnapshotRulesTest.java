package xyz.game.datamanage.service.simulation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class FiniteTargetCounterSnapshotRulesTest {
    private final ObjectMapper json = new ObjectMapper().findAndRegisterModules();
    private ObjectNode configuration() throws Exception {
        Path file = Path.of("../../web/tests/mechanisms/cases/target_counter_zero_expiry.json");
        if (!Files.exists(file)) file = Path.of("web/tests/mechanisms/cases/target_counter_zero_expiry.json");
        JsonNode test = json.readTree(Files.readString(file));
        for (JsonNode c : test.path("snapshot").path("skillConfigurations")) {
            if (c.path("internalStates").size() == 2) return (ObjectNode) c.deepCopy();
        }
        throw new AssertionError("缺少独立手算的完整目标计数机制用例");
    }
    @Test void completeDormantGraphPreservesDecimalAndOmittedMomentSemantics() throws Exception {
        ObjectNode configuration = configuration();
        assertTrue(FiniteTargetCounterSnapshotRules.complete(configuration));
        decimalValues(configuration);
        for (JsonNode rule : configuration.path("triggerRules")) {
            if (rule.path("eventSource").path("eventType").asText().equals("PROCESS_MOMENT")) {
                ((ObjectNode) rule.path("eventSource").path("detail").path("moment")).remove("failureReason");
            }
        }
        assertTrue(FiniteTargetCounterSnapshotRules.complete(configuration));
    }
    private void decimalValues(JsonNode node) {
        if (node.isObject() && node.path("kind").asText().equals("FIXED") && node.path("value").isNumber()) {
            ((ObjectNode) node).put("value", node.path("value").decimalValue());
        }
        if (node.isContainerNode()) node.forEach(this::decimalValues);
    }
    @Test void duplicateHitOrIndependentNaturalRootMustNotBeSilentlyDeferred() throws Exception {
        ObjectNode configuration = configuration();
        for (JsonNode rule : configuration.path("triggerRules")) {
            if (rule.path("eventSource").path("eventType").asText().equals("BASIC_ATTACK_HIT")) {
                ObjectNode duplicate = rule.deepCopy(); duplicate.put("ruleKey", "duplicate_real_hit");
                configuration.withArray("triggerRules").add(duplicate); break;
            }
        }
        assertFalse(FiniteTargetCounterSnapshotRules.complete(configuration));
        configuration = configuration();
        ObjectNode extra = configuration.withArray("triggerRules").addObject();
        extra.put("ruleKey", "extra_init"); extra.putObject("eventSource").put("eventType", "SOURCE_INITIALIZED").putObject("detail");
        extra.putArray("actions"); extra.putArray("conditionGroups");
        assertFalse(FiniteTargetCounterSnapshotRules.complete(configuration));
    }
    @Test void MissingExpiryOrForeignCounterOrExtraInitializationRemainsOrdinaryClosure() throws Exception {
        for (String variant : new String[]{"window", "foreign", "binding", "missing_tail", "extra_condition"}) {
            ObjectNode configuration = configuration();
            if (variant.equals("window")) ((ObjectNode) configuration.path("internalStates").get(1).path("detail")).remove("durationValue");
            if (variant.equals("foreign")) ((ObjectNode) configuration.path("internalStates").get(0)).put("skillKey", "foreign_skill");
            if (variant.equals("binding")) ((ObjectNode) configuration.path("internalStates").get(0).path("detail")).putObject("initialValueBinding");
            if (variant.equals("missing_tail")) for (int i = 0; i < configuration.path("triggerRules").size(); i++) if (configuration.path("triggerRules").get(i).path("eventSource").path("eventType").asText().equals("INTERNAL_STATE_CHANGED")) { configuration.withArray("triggerRules").remove(i); break; }
            if (variant.equals("extra_condition")) for (JsonNode r : configuration.path("triggerRules")) if (r.path("eventSource").path("eventType").asText().equals("INTERNAL_STATE_CHANGED")) ((ObjectNode) r.path("conditionGroups").get(0)).withArray("conditions").addObject().put("conditionType", "STATUS_CHECK");
            assertFalse(FiniteTargetCounterSnapshotRules.complete(configuration), variant);
        }
    }
    @Test void applicationMustBeZeroUnblockedRootAndCastCannotWriteTargetState() throws Exception {
        for (String variant : new String[]{"nonzero", "shield", "passive_cast", "cast_writes"}) {
            ObjectNode configuration = configuration();
            for (JsonNode rule : configuration.path("triggerRules")) {
                String type = rule.path("eventSource").path("eventType").asText();
                if (type.equals("SKILL_HIT") && rule.path("conditionGroups").isEmpty()) {
                    String effectKey = rule.path("actions").get(0).path("detail").path("effectKey").asText();
                    for (JsonNode effect : configuration.path("effects")) if (effect.path("effectKey").asText().equals(effectKey)) {
                        ObjectNode result = (ObjectNode) effect.path("results").get(0);
                        if (variant.equals("nonzero")) ((ObjectNode) result.path("valueRule").path("value")).put("value", 1);
                        if (variant.equals("shield")) result.putNull("spellShieldBlockScope");
                    }
                }
                if (type.equals("SKILL_USED")) {
                    String key = rule.path("actions").get(0).path("detail").path("processKey").asText();
                    for (JsonNode process : configuration.path("processes")) if (process.path("processKey").asText().equals(key)) {
                        if (variant.equals("passive_cast")) ((ObjectNode) process).put("activationType", "PASSIVE");
                        if (variant.equals("cast_writes")) ((ObjectNode) process).withArray("stateOperations").addObject().put("stateKey", "foreign_write");
                    }
                }
            }
            assertFalse(FiniteTargetCounterSnapshotRules.complete(configuration), variant);
        }
    }
}
