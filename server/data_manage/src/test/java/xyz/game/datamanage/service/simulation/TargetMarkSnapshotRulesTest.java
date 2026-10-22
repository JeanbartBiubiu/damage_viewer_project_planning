package xyz.game.datamanage.service.simulation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import static org.junit.jupiter.api.Assertions.*;

class TargetMarkSnapshotRulesTest {
    static final ObjectMapper JSON = new ObjectMapper().findAndRegisterModules();
    static ObjectNode configuration(String name) throws Exception {
        Path file = Path.of("../../web/tests/mechanisms/cases/" + name + ".json");
        if (!Files.exists(file)) file = Path.of("web/tests/mechanisms/cases/" + name + ".json");
        JsonNode test = JSON.readTree(Files.readString(file));
        for (JsonNode c : test.path("snapshot").path("skillConfigurations")) if (c.path("skill").path("skillKey").asText().equals("lab_mark")) return c.deepCopy();
        throw new AssertionError("固定目标标记作者图缺失");
    }
    static ObjectNode configuration() throws Exception { return configuration("target_mark_consumption_skill_restore_clip"); }
    static ObjectNode find(JsonNode c, String section, String key, String value) {
        for (JsonNode row : c.path(section)) if (row.path(key).asText().equals(value)) return (ObjectNode) row;
        throw new AssertionError(section + ":" + value);
    }
    @ParameterizedTest
    @ValueSource(strings = {"target_mark_consumption_skill_restore_clip", "target_mark_consumption_basic_no_resource",
        "target_mark_consumption_live_ability_power", "target_mark_consumption_payload_lethal", "target_mark_consumption_root_lethal_tail",
        "target_mark_consumption_miss_exact_expiry", "target_mark_consumption_reapply_old_deadline", "target_mark_consumption_two_siblings_once"})
    void completeSyntheticAuthorGraphsAreRecognizedWithoutSkillNameSpecialCases(String name) throws Exception {
        assertTrue(TargetMarkSnapshotRules.complete(configuration(name)), name);
    }
    @Test void decimalFixedValuesAndOmittedNullableMomentsKeepTheirMeaning() throws Exception {
        ObjectNode c = configuration(); decimal(c);
        for (JsonNode process : c.path("processes")) {
            for (JsonNode operation : process.path("stateOperations")) ((ObjectNode) operation.path("moment")).remove("failureReason");
            for (JsonNode binding : process.path("effectBindings")) ((ObjectNode) binding.path("moment")).remove("failureReason");
        }
        assertTrue(TargetMarkSnapshotRules.complete(c));
    }
    private static void decimal(JsonNode node) {
        if (node.isObject() && node.path("kind").asText().equals("FIXED") && node.path("value").isNumber())
            ((ObjectNode) node).put("value", node.path("value").decimalValue().setScale(2));
        node.forEach(TargetMarkSnapshotRulesTest::decimal);
    }
    @ParameterizedTest
    @ValueSource(strings = {"extra_natural", "missing_root", "extra_process", "extra_effect", "foreign_state", "unbounded",
        "wrong_cap", "wrong_initial", "fractional_duration", "negative_duration", "wrong_clear", "extra_writer", "missing_unblocked", "restore_hp", "restore_dynamic",
        "attack_restore", "wrong_damage_scope", "crit", "extra_action", "hidden_binding", "unknown_detail", "detail_metadata", "missing_formula", "state_flag"})
    void incompleteOrMixedGraphsNeverBecomeDormant(String variant) throws Exception {
        ObjectNode c = configuration();
        ObjectNode state = (ObjectNode) c.path("internalStates").get(0);
        ObjectNode attack = find(c, "processes", "processKey", "attack");
        ObjectNode skill = find(c, "effects", "effectKey", "skill_payload");
        switch (variant) {
            case "extra_natural" -> { ObjectNode r = find(c, "triggerRules", "ruleKey", "root_hit").deepCopy(); r.put("ruleKey", "other"); ((ObjectNode) r.path("eventSource")).put("eventType", "SOURCE_INITIALIZED"); c.withArray("triggerRules").add(r); }
            case "missing_root" -> { for (int i = 0; i < c.path("triggerRules").size(); i++) if (c.path("triggerRules").get(i).path("ruleKey").asText().equals("root_hit")) { c.withArray("triggerRules").remove(i); break; } }
            case "extra_process" -> { ObjectNode p = attack.deepCopy(); p.put("processKey", "unused"); c.withArray("processes").add(p); }
            case "extra_effect" -> { ObjectNode e = skill.deepCopy(); e.put("effectKey", "unused"); c.withArray("effects").add(e); }
            case "foreign_state" -> state.put("skillKey", "foreign");
            case "unbounded" -> ((ObjectNode) state.path("detail")).putNull("durationValue");
            case "wrong_cap" -> ((ObjectNode) state.path("detail").path("maxValue")).put("value", 2);
            case "wrong_initial" -> ((ObjectNode) state.path("detail").path("initialValue")).put("value", 1);
            case "fractional_duration" -> find(c, "parameters", "parameterKey", "mark_ms").put("fixedValue", 1.5);
            case "negative_duration" -> find(c, "parameters", "parameterKey", "mark_ms").put("fixedValue", -1);
            case "wrong_clear" -> ((ObjectNode) attack.path("stateOperations").get(0).path("value")).put("value", 1);
            case "extra_writer" -> attack.withArray("stateOperations").add(attack.path("stateOperations").get(0).deepCopy());
            case "missing_unblocked" -> find(c, "triggerRules", "ruleKey", "apply_mark").putArray("conditionGroups");
            case "restore_hp" -> ((ObjectNode) skill.path("results").get(1).path("detail")).put("attributeKey", "hp");
            case "restore_dynamic" -> { ObjectNode value = JSON.createObjectNode().put("kind", "PARAMETER").put("parameterKey", "external"); ((ObjectNode) skill.path("results").get(1).path("valueRule")).set("value", value); c.withArray("parameters").addObject().put("parameterKey", "external").put("valueMode", "RUNTIME_INPUT"); }
            case "attack_restore" -> find(c, "effects", "effectKey", "attack_payload").withArray("results").add(skill.path("results").get(1).deepCopy());
            case "wrong_damage_scope" -> ((ObjectNode) skill.path("results").get(0)).put("spellShieldBlockScope", "SKILL");
            case "crit" -> ((ObjectNode) skill.path("results").get(0).path("detail").path("critical")).put("mode", "EXPECTED");
            case "extra_action" -> find(c, "triggerRules", "ruleKey", "consume_attack").withArray("actions").add(find(c, "triggerRules", "ruleKey", "root_hit").path("actions").get(0).deepCopy());
            case "hidden_binding" -> ((ObjectNode) find(c, "triggerRules", "ruleKey", "consume_attack").path("actions").get(0)).withArray("runtimeInputBindings").addObject().put("parameterKey", "hidden");
            case "unknown_detail" -> ((ObjectNode) attack.path("steps").get(0).path("detail")).put("hidden", true);
            case "detail_metadata" -> ((ObjectNode) attack.path("steps").get(0).path("detail")).put("name", "不能把实体元数据带进即时明细");
            case "missing_formula" -> ((ObjectNode) skill.path("results").get(0).path("valueRule").path("value")).put("formulaKey", "missing");
            case "state_flag" -> state.put("stateType", "FLAG");
            default -> throw new AssertionError(variant);
        }
        assertFalse(TargetMarkSnapshotRules.complete(c), variant);
    }
    @Test void harmlessOwnCostDeclarationsAndCategoryQualificationStayClosed() throws Exception {
        ObjectNode c = configuration();
        c.withArray("effects").add(JSON.readTree("""
            {"gameId":"mechanism_lab","skillKey":"lab_mark","effectKey":"cost","lifecycle":null,"results":[
             {"resultKey":"mana","resultType":"RESOURCE_CHANGE","target":"SOURCE","lifecycleBehavior":null,"spellShieldBlockScope":null,
              "valueRule":{"value":{"kind":"FIXED","value":50},"fixedMultiplier":1,"fixedMinValue":0,"fixedMaxValue":null},
              "detail":{"attributeKey":"mana","operation":"CONSUME"}}]}
            """));
        find(c, "processes", "processKey", "cast").withArray("effectBindings").add(JSON.readTree("""
            {"bindingKey":"cost","effectKey":"cost","sortOrder":0,"moment":{"momentType":"PROCESS_START","stepKey":null,"failureReason":null}}
            """));
        ObjectNode root = find(c, "triggerRules", "ruleKey", "root_hit"), application = find(c, "triggerRules", "ruleKey", "apply_mark");
        ObjectNode category = JSON.createObjectNode().put("conditionKey", "category").put("conditionType", "TARGET_CATEGORY_CHECK").put("sortOrder", 1);
        category.putObject("detail").putArray("categories").add("CHAMPION");
        root.putArray("conditionGroups").addObject().put("groupKey", "eligible").putArray("conditions").add(category);
        ((ObjectNode) application.path("conditionGroups").get(0)).withArray("conditions").insert(0, category.deepCopy());
        assertTrue(TargetMarkSnapshotRules.complete(c));
        ((ObjectNode) application.path("conditionGroups").get(0).path("conditions").get(0).path("detail")).putArray("categories").add("MINION");
        assertFalse(TargetMarkSnapshotRules.complete(c));
    }
    @Test void staticFormulaDeclarationIsRecognizedButHiddenRuntimeInputsAreNot() throws Exception {
        ObjectNode c = configuration();
        ObjectNode formula = JSON.createObjectNode().put("formulaKey", "static_restore");
        ObjectNode expression = formula.putObject("expression"); expression.putArray("inputs");
        expression.putArray("stages").addObject().put("key", "output").putObject("expression").put("op", "const").put("value", "60");
        expression.put("outputStageKey", "output"); c.withArray("formulas").add(formula);
        ObjectNode restore = (ObjectNode) find(c, "effects", "effectKey", "skill_payload").path("results").get(1).path("valueRule");
        restore.set("value", JSON.createObjectNode().put("kind", "FORMULA").put("formulaKey", "static_restore"));
        assertTrue(TargetMarkSnapshotRules.complete(c));
        expression.withArray("inputs").addObject().put("key", "unused").putObject("binding")
            .put("kind", "parameter").put("skillKey", "lab_mark").put("parameterKey", "external");
        c.withArray("parameters").addObject().put("parameterKey", "external").put("valueMode", "RUNTIME_INPUT");
        assertFalse(TargetMarkSnapshotRules.complete(c));
    }
}
