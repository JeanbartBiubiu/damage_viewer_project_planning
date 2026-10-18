package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.support.authoring.SkillNumericSemantics.Parameter;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

class SkillAmmoAuthoringSemanticsTest {
    static final String SKILL = "missile";

    @Test void stateDeclarationsAreConsumedOnceAndDoNotBecomePerCastBindings() {
        var ammo = ammo(true);
        var process = process();
        var action = startRule();
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(ammo, process, action), inputs()));
        var counter = counter("phase", "initial_phase");
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(counter), inputs()));
        assertFalse(ammo.data().path("detail").path("initialValueBinding").path("detail").has("value"));
    }

    @ParameterizedTest @ValueSource(strings = {"TARGET_SCOPE", "WRONG_SOURCE", "UNCONSUMED", "WRONG_KEY",
        "NEGATIVE_MIN", "FRACTIONAL_BOUND", "UNSAFE_BOUND", "DEFAULT", "NON_INTEGER", "OTHER_SKILL",
        "CAPACITY_BORROW", "INTERVAL_BORROW", "REMAINING_MODE", "REMAINING_CONDITION", "UNBOUND_REMAINING"})
    void stateBindingFinalChangesCannotKeepOldAuthorization(String change) {
        var state = ammo(true);
        ObjectNode data = (ObjectNode) state.data(), detail = (ObjectNode) data.path("detail");
        ObjectNode binding = (ObjectNode) detail.path("initialValueBinding");
        List<Parameter> parameters = new ArrayList<>(inputs());
        switch (change) {
            case "TARGET_SCOPE" -> data.put("scope", "TARGET");
            case "WRONG_SOURCE" -> binding.put("sourceType", "EVENT_VALUE");
            case "UNCONSUMED" -> detail.set("initialValue", fixed(1));
            case "WRONG_KEY" -> binding.put("parameterKey", "initial_phase");
            case "NEGATIVE_MIN" -> ((ObjectNode) binding.path("detail")).put("minValue", -1);
            case "FRACTIONAL_BOUND" -> ((ObjectNode) binding.path("detail")).put("minValue", 0.5);
            case "UNSAFE_BOUND" -> ((ObjectNode) binding.path("detail")).put("maxValue", new BigDecimal("9007199254740992"));
            case "DEFAULT" -> parameters.set(0, new Parameter(SKILL, "initial_stock", "INTEGER", "RUNTIME_INPUT", BigDecimal.ZERO, null));
            case "NON_INTEGER" -> parameters.set(0, input("initial_stock", "DECIMAL"));
            case "OTHER_SKILL" -> parameters.set(0, new Parameter("other", "initial_stock", "INTEGER", "RUNTIME_INPUT", null, null));
            case "CAPACITY_BORROW" -> detail.set("maxValue", parameter("initial_stock"));
            case "INTERVAL_BORROW" -> detail.set("recoveryIntervalValue", parameter("initial_stock"));
            case "REMAINING_MODE" -> detail.put("recoveryMode", "ALL_AT_ONCE");
            case "REMAINING_CONDITION" -> detail.put("recoveryStartCondition", "WHEN_EMPTY");
            case "UNBOUND_REMAINING" -> detail.remove("initialRemainingMsBinding");
            default -> throw new IllegalArgumentException(change);
        }
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(state), parameters));
    }

    @ParameterizedTest @ValueSource(strings = {"-1", "0.5", "9007199254740992"})
    void staticInitialRemainingMustBeNonNegativeSafeIntegerMilliseconds(String value) {
        var state = ammo(false);
        ((ObjectNode) state.data().path("detail")).set("initialRemainingValue", AggregateJson.tree("{\"kind\":\"FIXED\",\"value\":" + value + "}"));
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(state), List.of()));
    }

    @Test void staticInitialRemainingZeroAndPositiveAreStoredWithoutInventingBattleInventory() {
        for (int remaining : List.of(0, 20000)) {
            var state = ammo(false);
            ((ObjectNode) state.data().path("detail")).set("initialRemainingValue", fixed(remaining));
            assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(state), List.of()));
        }
    }

    @Test void refundCanUseARealAttributeCommonFormulaWithoutRuntimeInputBindings() {
        var rule = refundRule(false);
        ((ObjectNode) rule.data().path("actions").get(0).path("detail")).set("value", formulaValue("refund_ms"));
        var definition = xyz.game.datamanage.support.formula.SkillFormulaFixtures.attribute("source", "critical_strike_chance", "TOTAL");
        var formula = new Aggregate(SourceType.FORMULA, SKILL, "refund_ms",
            new com.fasterxml.jackson.databind.ObjectMapper().createObjectNode().set("expression", definition));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(ammo(false), formula, rule), inputs()));
    }

    @ParameterizedTest @ValueSource(strings = {"EVENT", "TARGET", "FOREIGN_STATE", "COUNTER", "TARGET_STATE", "OPERATION",
        "MODIFIER", "OTHER_BINDING", "RUNTIME_VALUE", "SCENE_BINDING", "NEGATIVE_VALUE", "RUNTIME_FORMULA", "RULE_TIMING"})
    void refundRemainsAnOwnAmmoBasicAttackHitAction(String change) {
        var state = ammo(false);
        var rule = refundRule(false);
        ObjectNode action = (ObjectNode) rule.data().path("actions").get(0), detail = (ObjectNode) action.path("detail");
        List<Parameter> parameters = new ArrayList<>(inputs());
        switch (change) {
            case "EVENT" -> ((ObjectNode) rule.data().path("eventSource")).put("eventType", "SKILL_HIT");
            case "TARGET" -> action.put("targetContext", "CURRENT_TARGET");
            case "FOREIGN_STATE" -> detail.put("stateSkillKey", "other");
            case "COUNTER" -> ((ObjectNode) state.data()).put("stateType", "COUNTER");
            case "TARGET_STATE" -> ((ObjectNode) state.data()).put("scope", "TARGET");
            case "OPERATION" -> detail.put("operation", "SET");
            case "MODIFIER" -> action.set("resultModifiers", AggregateJson.tree("[{\"resultKey\":\"x\"}]"));
            case "OTHER_BINDING" -> action.withArray("runtimeInputBindings").add(sceneBinding("refund", "refund_input", 0, 20000).put("sourceType", "EVENT_VALUE"));
            case "RUNTIME_VALUE" -> detail.set("value", parameter("refund_input"));
            case "SCENE_BINDING" -> action.withArray("runtimeInputBindings").add(sceneBinding("refund", "refund_input", 0, 20000));
            case "NEGATIVE_VALUE" -> { detail.set("value", fixed(-1)); action.putArray("runtimeInputBindings"); }
            case "RUNTIME_FORMULA" -> detail.set("value", formulaValue("runtime_refund"));
            case "RULE_TIMING" -> ((ObjectNode) rule.data()).set("limits", AggregateJson.tree("{\"perTargetCooldown\":{\"durationValue\":{\"kind\":\"PARAMETER\",\"parameterKey\":\"refund_input\"}}}"));
            default -> throw new IllegalArgumentException(change);
        }
        var objects = new ArrayList<>(List.of(state, rule));
        if (change.equals("RUNTIME_FORMULA")) objects.add(formula("runtime_refund", "refund_input", "{\"op\":\"read\",\"inputKey\":\"input_0\"}"));
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(objects, parameters));
    }

    @Test void frozenPhaseAndNextPhaseAreTwoActualProcessStartAssignments() {
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(cycleObjects(), inputs()));
    }

    @ParameterizedTest @ValueSource(strings = {"WRONG_EVENT", "WRONG_PHASE", "WRONG_OWNER", "AMMO_READ", "TARGET_READ",
        "WRONG_KIND", "WRONG_SOURCE", "DECIMAL_INPUT", "DEFAULT_INPUT", "INCREASE", "LATE_WRITE", "AMMO_WRITE", "TARGET_WRITE", "ATTRIBUTE_FORMULA"})
    void dynamicCycleAssignmentsCannotExpandBeyondOwnIntegerStartSet(String change) {
        var objects = cycleObjects();
        var process = objects.stream().filter(a -> a.type() == SourceType.PROCESS).findFirst().orElseThrow();
        var rule = objects.stream().filter(a -> a.type() == SourceType.TRIGGER).findFirst().orElseThrow();
        var state = objects.stream().filter(a -> a.key().equals("phase")).findFirst().orElseThrow();
        var frozen = objects.stream().filter(a -> a.key().equals("frozen")).findFirst().orElseThrow();
        ObjectNode event = (ObjectNode) rule.data().path("eventSource"), binding = (ObjectNode) rule.data().path("actions").get(0).path("runtimeInputBindings").get(0);
        ObjectNode operation = (ObjectNode) process.data().path("stateOperations").get(1);
        List<Parameter> parameters = new ArrayList<>(inputs());
        switch (change) {
            case "WRONG_EVENT" -> event.put("eventType", "BASIC_ATTACK_HIT");
            case "WRONG_PHASE" -> ((ObjectNode) event.path("detail")).put("castPhase", "RECAST");
            case "WRONG_OWNER" -> ((ObjectNode) binding.path("detail")).put("stateSkillKey", "other");
            case "AMMO_READ" -> ((ObjectNode) state.data()).put("stateType", "AMMO");
            case "TARGET_READ" -> ((ObjectNode) state.data()).put("scope", "TARGET");
            case "WRONG_KIND" -> ((ObjectNode) binding.path("detail")).put("valueKind", "REMAINING_MS");
            case "WRONG_SOURCE" -> { binding.put("sourceType", "EVENT_VALUE"); binding.set("detail", AggregateJson.tree("{\"eventValueKey\":\"HIT_INDEX\"}")); }
            case "DECIMAL_INPUT" -> parameters.set(4, input("phase_read", "DECIMAL"));
            case "DEFAULT_INPUT" -> parameters.set(4, new Parameter(SKILL, "phase_read", "INTEGER", "RUNTIME_INPUT", BigDecimal.ONE, null));
            case "INCREASE" -> operation.put("operation", "INCREASE");
            case "LATE_WRITE" -> ((ObjectNode) operation.path("moment")).put("momentType", "PROCESS_COMPLETE");
            case "AMMO_WRITE" -> ((ObjectNode) frozen.data()).put("stateType", "AMMO");
            case "TARGET_WRITE" -> ((ObjectNode) frozen.data()).put("scope", "TARGET");
            case "ATTRIBUTE_FORMULA" -> {
                var formula = objects.stream().filter(a -> a.type() == SourceType.FORMULA).findFirst().orElseThrow();
                ObjectNode definition = (ObjectNode) formula.data().path("expression");
                definition.withArray("inputs").addObject().put("key", "attribute").putObject("binding")
                    .put("kind", "attribute").put("object", "source").put("attributeKey", "hp").put("valueKind", "TOTAL").put("view", "current_frame");
                ((ObjectNode) definition.path("stages").get(0)).set("expression", AggregateJson.tree("{\"op\":\"add\",\"args\":[{\"op\":\"read\",\"inputKey\":\"input_0\"},{\"op\":\"read\",\"inputKey\":\"attribute\"}]}"));
            }
            default -> throw new IllegalArgumentException(change);
        }
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(objects, parameters));
    }

    static List<Aggregate> cycleObjects() {
        var process = process();
        ((ObjectNode) process.data()).set("stateOperations", AggregateJson.tree("""
            [{"stateSkillKey":"missile","stateKey":"frozen","operation":"SET","value":{"kind":"PARAMETER","parameterKey":"phase_read"},"moment":{"momentType":"PROCESS_START"}},
             {"stateSkillKey":"missile","stateKey":"phase","operation":"SET","value":{"kind":"FORMULA","formulaKey":"next_phase"},"moment":{"momentType":"PROCESS_START"}}]
            """));
        var rule = startRule();
        ((ObjectNode) rule.data().path("actions").get(0)).set("runtimeInputBindings", AggregateJson.tree("""
            [{"bindingKey":"read_phase","parameterKey":"phase_read","sourceType":"INTERNAL_STATE",
             "detail":{"stateSkillKey":"missile","stateKey":"phase","valueKind":"VALUE"}}]
            """));
        String expression = """
            {"op":"if","args":[{"op":"eq","args":[{"op":"read","inputKey":"input_0"},{"op":"const","value":"3"}]},
             {"op":"const","value":"1"},{"op":"add","args":[{"op":"read","inputKey":"input_0"},{"op":"const","value":"1"}]}]}
            """;
        return List.of(counter("phase", "initial_phase"), fixedCounter("frozen"), process,
            formula("next_phase", "phase_read", expression), rule);
    }

    static Aggregate ammo(boolean bound) {
        ObjectNode detail = (ObjectNode) AggregateJson.tree("""
            {"initialValue":{"kind":"FIXED","value":1},"maxValue":{"kind":"FIXED","value":4},
             "recoveryIntervalValue":{"kind":"FIXED","value":20000},"recoveryMode":"ONE_BY_ONE","recoveryStartCondition":"AFTER_CONSUME"}
            """);
        if (bound) {
            detail.set("initialValue", parameter("initial_stock"));
            detail.set("initialValueBinding", sceneBinding("stock", "initial_stock", 0, 4));
            detail.set("initialRemainingValue", parameter("initial_remaining"));
            detail.set("initialRemainingMsBinding", sceneBinding("remaining", "initial_remaining", 0, 20000));
        }
        ObjectNode data = (ObjectNode) AggregateJson.tree("{\"stateType\":\"AMMO\",\"scope\":\"SKILL\"}");
        data.set("detail", detail);
        return new Aggregate(SourceType.STATE, SKILL, "ammo", data);
    }

    static Aggregate counter(String key, String input) {
        var state = fixedCounter(key);
        ObjectNode detail = (ObjectNode) state.data().path("detail");
        detail.set("initialValue", parameter(input));
        detail.set("initialValueBinding", sceneBinding("initial", input, 1, 3));
        return state;
    }

    static Aggregate fixedCounter(String key) {
        return object(SourceType.STATE, key, "{\"stateType\":\"COUNTER\",\"scope\":\"SKILL\",\"detail\":{\"initialValue\":{\"kind\":\"FIXED\",\"value\":0},\"maxValue\":{\"kind\":\"FIXED\",\"value\":3}}}");
    }

    static Aggregate process() {
        return object(SourceType.PROCESS, "cast", "{\"activationType\":\"ACTIVE\",\"steps\":[],\"effectBindings\":[],\"stateOperations\":[{\"stateSkillKey\":\"missile\",\"stateKey\":\"ammo\",\"operation\":\"CONSUME\",\"value\":{\"kind\":\"FIXED\",\"value\":1},\"moment\":{\"momentType\":\"PROCESS_START\"}}]}");
    }

    static Aggregate startRule() {
        return object(SourceType.TRIGGER, "start", """
            {"eventSource":{"eventType":"SKILL_USED","detail":{"sourceSkillKey":"missile","castPhase":"INITIAL"}},"conditionGroups":[],
             "actions":[{"actionKey":"cast","actionType":"START_PROCESS","targetContext":"CURRENT_TARGET","detail":{"processKey":"cast"},"runtimeInputBindings":[],"resultModifiers":[]}]}
            """);
    }

    static Aggregate refundRule(boolean bound) {
        var rule = object(SourceType.TRIGGER, "refund", """
            {"eventSource":{"eventType":"BASIC_ATTACK_HIT","detail":{}},"conditionGroups":[],
             "actions":[{"actionKey":"refund","actionType":"MODIFY_INTERNAL_STATE","targetContext":"EVENT_SOURCE",
             "detail":{"stateSkillKey":"missile","stateKey":"ammo","operation":"REDUCE_RECOVERY","value":{"kind":"FIXED","value":0}},
             "runtimeInputBindings":[],"resultModifiers":[]}]}
            """);
        if (bound) {
            var action = (ObjectNode) rule.data().path("actions").get(0);
            ((ObjectNode) action.path("detail")).set("value", parameter("refund_input"));
            action.withArray("runtimeInputBindings").add(sceneBinding("refund", "refund_input", 0, 100000));
        }
        return rule;
    }

    static Aggregate formula(String key, String parameter, String expression) {
        var definition = xyz.game.datamanage.support.formula.SkillFormulaFixtures.parameter(SKILL, parameter);
        ((ObjectNode) definition.path("stages").get(0)).set("expression", AggregateJson.tree(expression));
        return new Aggregate(SourceType.FORMULA, SKILL, key,
            new com.fasterxml.jackson.databind.ObjectMapper().createObjectNode().set("expression", definition));
    }

    static ObjectNode sceneBinding(String key, String parameter, int min, int max) {
        return (ObjectNode) AggregateJson.tree("{\"bindingKey\":\"" + key + "\",\"parameterKey\":\"" + parameter
            + "\",\"sourceType\":\"SCENE_INITIAL_PARAMETER\",\"detail\":{\"minValue\":" + min + ",\"maxValue\":" + max + "}}");
    }
    static ObjectNode fixed(int value) { return (ObjectNode) AggregateJson.tree("{\"kind\":\"FIXED\",\"value\":" + value + "}"); }
    static ObjectNode parameter(String key) { return (ObjectNode) AggregateJson.tree("{\"kind\":\"PARAMETER\",\"parameterKey\":\"" + key + "\"}"); }
    static ObjectNode formulaValue(String key) { return (ObjectNode) AggregateJson.tree("{\"kind\":\"FORMULA\",\"formulaKey\":\"" + key + "\"}"); }
    static Aggregate object(SourceType type, String key, String data) { return new Aggregate(type, SKILL, key, AggregateJson.tree(data)); }
    static Parameter input(String key, String type) { return new Parameter(SKILL, key, type, "RUNTIME_INPUT", null, null); }
    static List<Parameter> inputs() { return List.of(input("initial_stock", "INTEGER"), input("initial_remaining", "INTEGER"),
        input("initial_phase", "INTEGER"), input("refund_input", "DECIMAL"), input("phase_read", "INTEGER")); }
}
