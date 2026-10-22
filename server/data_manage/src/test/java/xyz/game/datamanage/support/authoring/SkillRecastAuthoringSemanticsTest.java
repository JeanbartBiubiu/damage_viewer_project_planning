package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.support.authoring.SkillNumericSemantics.Parameter;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Target;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.TargetType;
import xyz.game.datamanage.support.error.ApiException;

class SkillRecastAuthoringSemanticsTest {
    @ParameterizedTest
    @CsvSource({"1,1,1", "15000,2,1000", "1000,63,15000", "9007199254740991,63,9007199254740991"})
    void acceptsPositiveSafeTimesAndAtMostSixtyThreeExtraExecutions(String window, String count, String interval) {
        var process = numeric(fixed(window), fixed(count), fixed(interval));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(process), List.of()));
    }

    @ParameterizedTest
    @ValueSource(strings = {"windowValue", "maximumRecastCountValue", "intervalValue"})
    void invalidFixedValuesFailAtTheirExactAuthorPath(String field) {
        for (String bad : List.of("0", "-1", "1.5", "9007199254740992")) {
            var process = numeric(fixed("15000"), fixed("2"), fixed("1000"));
            ((ObjectNode) process.data().path("steps").get(0).path("detail")).set(field, AggregateJson.tree(fixed(bad)));
            issue(process, List.of(), field, null);
        }
        if (field.equals("maximumRecastCountValue")) {
            issue(numeric(fixed("15000"), fixed("64"), fixed("1000")), List.of(), field, "VALUE_RANGE_INVALID");
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"windowValue", "maximumRecastCountValue"})
    void mandatoryValuesCannotBeOmittedOrNull(String field) {
        for (boolean explicitNull : List.of(false, true)) {
            var process = numeric(fixed("15000"), fixed("2"), null);
            var detail = (ObjectNode) process.data().path("steps").get(0).path("detail");
            if (explicitNull) detail.putNull(field); else detail.remove(field);
            issue(process, List.of(), field, "REQUIRED");
        }
    }

    @Test
    void intervalOmissionAndNullRemainUnconfiguredAndLegacyChargeIsUnaffected() {
        var process = numeric(fixed("15000"), fixed("1"), null);
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(process), List.of()));
        ((ObjectNode) process.data().path("steps").get(0).path("detail")).putNull("intervalValue");
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(process), List.of()));
        var charge = aggregate(SourceType.PROCESS, "charge", """
            {"steps":[{"stepKey":"charge","stepType":"CHARGE","detail":{"minimumChargeValue":{"kind":"FIXED","value":0},
              "maximumChargeValue":{"kind":"FIXED","value":0}}}],"effectBindings":[],"stateOperations":[]}
            """);
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(charge), List.of()));
    }

    @ParameterizedTest
    @ValueSource(strings = {"windowValue", "maximumRecastCountValue", "intervalValue"})
    void everyParameterLevelAndReachableFormulaBranchIsChecked(String field) {
        var process = numeric(fixed("15000"), fixed("2"), fixed("1000"));
        ((ObjectNode) process.data().path("steps").get(0).path("detail")).set(field, AggregateJson.tree(parameter("levels")));
        var values = new Parameter("spell", "levels", "INTEGER", "SKILL_LEVEL", null, AggregateJson.tree("{\"1\":1,\"2\":2,\"3\":3}"));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(process), List.of(values)));
        var invalid = new Parameter("spell", "levels", "INTEGER", "SKILL_LEVEL", null, AggregateJson.tree("{\"1\":1,\"2\":2,\"3\":0}"));
        issue(process, List.of(invalid), field, "VALUE_RANGE_INVALID");
        issue(process, List.of(new Parameter("spell", "levels", "INTEGER", "RUNTIME_INPUT", null, null)), field, "RUNTIME_INPUT_FORBIDDEN");

        var formula = formula("gap", "{\"kind\":\"attribute\",\"object\":\"source\",\"attributeKey\":\"ability_power\",\"valueKind\":\"TOTAL\",\"view\":\"current_frame\"}");
        ((ObjectNode) process.data().path("steps").get(0).path("detail")).set(field, AggregateJson.tree("{\"kind\":\"FORMULA\",\"formulaKey\":\"gap\"}"));
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(process, formula), List.of()));

        // The unused arithmetic branch is not executed, but its input dependencies
        // must still be static and complete in every author-level combination.
        var input = "{\"kind\":\"parameter\",\"skillKey\":\"spell\",\"parameterKey\":\"levels\"}";
        var staticFormula = formula("gap", input);
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(process, staticFormula), List.of(values)));
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(process, staticFormula),
            List.of(new Parameter("spell", "levels", "INTEGER", "RUNTIME_INPUT", null, null))));
    }

    @ParameterizedTest
    @ValueSource(strings = {"PARAMETER", "FORMULA"})
    void intervalReferencesFeedTheSameReadAndDeleteProtection(String kind) {
        String field = kind.equals("PARAMETER") ? "parameterKey" : "formulaKey";
        var process = numeric(fixed("15000"), fixed("2"), "{\"kind\":\"" + kind + "\",\"" + field + "\":\"gap\"}");
        var target = new Target(TargetType.valueOf(kind), "spell", "gap", "");
        var refs = SkillObjectReferences.extractAndValidate("lol", List.of(process), Set.of(target));
        assertEquals(1, refs.size());
        assertEquals("steps[0].detail.intervalValue." + field, refs.getFirst().fieldPath());
        assertEquals(refs, SkillObjectReferences.extract("lol", List.of(process)));
        if (kind.equals("FORMULA"))
            assertTrue(SkillObjectReferences.belongsTo(target, new Aggregate(SourceType.FORMULA, "spell", "gap", AggregateJson.tree("{}"))));
        assertThrows(ApiException.class, () -> SkillObjectReferences.extractAndValidate("lol", List.of(process), Set.of()));
    }

    @Test
    void acceptsOnlyIndependentFirstAndRecastHitPhasesInDeclaredOrder() {
        var context = phases();
        assertDoesNotThrow(() -> SkillHitPhaseSemantics.validate(context, context));
        var steps = (ArrayNode) context.getFirst().data().path("steps");
        JsonNode last = steps.remove(1); steps.insert(0, last);
        assertDoesNotThrow(() -> SkillHitPhaseSemantics.validate(context, context));
    }

    @ParameterizedTest
    @ValueSource(strings = {"first_busy", "recast_busy", "missing_occupation", "null_occupation", "delay_first", "reversed", "extra_step",
        "not_recast", "prior_hit", "missing_first_hit", "missing_recast_hit", "duplicate_order", "missing_order"})
    void rejectsUnsupportedRecastGraphsWithoutExpandingLegacySequences(String mode) {
        var context = phases();
        var steps = (ArrayNode) context.getFirst().data().path("steps");
        var first = (ObjectNode) steps.get(0); var last = (ObjectNode) steps.get(1);
        switch (mode) {
            case "first_busy" -> first.put("occupiesAction", true);
            case "recast_busy" -> last.put("occupiesAction", true);
            case "missing_occupation" -> first.remove("occupiesAction");
            case "null_occupation" -> last.putNull("occupiesAction");
            case "delay_first" -> first.put("stepType", "DELAY");
            case "reversed" -> { first.put("sortOrder", 2); last.put("sortOrder", 1); }
            case "extra_step" -> steps.add(AggregateJson.tree("{\"stepKey\":\"later\",\"stepType\":\"IMMEDIATE\",\"sortOrder\":2,\"occupiesAction\":false}"));
            case "not_recast" -> last.put("stepType", "IMMEDIATE");
            case "prior_hit" -> ((ObjectNode) context.get(3).data().path("eventSource").path("detail").path("processMoment")).put("requiresPriorStepKey", "first");
            case "missing_first_hit" -> context.remove(2);
            case "missing_recast_hit" -> context.remove(3);
            case "duplicate_order" -> last.put("sortOrder", 0);
            case "missing_order" -> last.remove("sortOrder");
            default -> fail(mode);
        }
        var error = assertThrows(ApiException.class, () -> SkillHitPhaseSemantics.validate(context, context));
        assertEquals("409.SKILL_HIT_PHASE_INVALID", error.getCode());
    }

    private static void issue(Aggregate process, List<Parameter> parameters, String field, String code) {
        var error = assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(process), parameters));
        assertEquals("400.INVALID_SKILL_NUMERIC_VALUE", error.getCode());
        assertTrue(error.getDetails().toString().contains("steps[0].detail." + field), error.getDetails().toString());
        if (code != null) assertTrue(error.getDetails().toString().contains(code), error.getDetails().toString());
    }

    private static Aggregate numeric(String window, String count, String interval) {
        return aggregate(SourceType.PROCESS, "cast", "{\"steps\":[{\"stepKey\":\"again\",\"stepType\":\"RECAST\",\"detail\":{\"windowValue\":" + window
            + ",\"maximumRecastCountValue\":" + count + (interval == null ? "" : ",\"intervalValue\":" + interval)
            + "}}],\"effectBindings\":[],\"stateOperations\":[]}");
    }
    private static String fixed(String number) { return "{\"kind\":\"FIXED\",\"value\":" + number + "}"; }
    private static String parameter(String key) { return "{\"kind\":\"PARAMETER\",\"parameterKey\":\"" + key + "\"}"; }
    private static Aggregate formula(String key, String binding) {
        return aggregate(SourceType.FORMULA, key, """
            {"expression":{"inputs":[{"key":"value","binding":%s}],"stages":[{"key":"output","name":"静态时间",
              "expression":{"op":"if","args":[{"op":"const","value":"0"},{"op":"read","inputKey":"value"},{"op":"const","value":"1"}]}}],"outputStageKey":"output"}}
            """.formatted(binding));
    }
    private static ArrayList<Aggregate> phases() {
        var result = new ArrayList<Aggregate>();
        result.add(aggregate(SourceType.PROCESS, "cast", """
            {"activationType":"ACTIVE","steps":[
              {"stepKey":"first","stepType":"IMMEDIATE","sortOrder":0,"occupiesAction":false,"detail":{}},
              {"stepKey":"again","stepType":"RECAST","sortOrder":1,"occupiesAction":false,"detail":{"windowValue":{"kind":"FIXED","value":15000},"maximumRecastCountValue":{"kind":"FIXED","value":2},"intervalValue":{"kind":"FIXED","value":1000}}}],
             "effectBindings":[],"stateOperations":[]}
            """));
        result.add(aggregate(SourceType.TRIGGER, "start", """
            {"eventSource":{"eventType":"SKILL_USED","detail":{"sourceSkillKey":"spell","useKind":"ACTIVE","castPhase":"INITIAL"}},
             "conditionGroups":[],"actions":[{"actionKey":"start","actionType":"START_PROCESS","detail":{"processKey":"cast"}}]}
            """));
        result.add(hit("first_hit", "first")); result.add(hit("recast_hit", "again"));
        return result;
    }
    private static Aggregate hit(String key, String step) {
        return aggregate(SourceType.TRIGGER, key, """
            {"eventSource":{"eventType":"SKILL_HIT","detail":{"sourceSkillKey":"spell","processMoment":{"processKey":"cast",
              "moment":{"momentType":"STEP_EXECUTION","stepKey":"%s"},"requiresPriorStepKey":null}}},
             "conditionGroups":[],"actions":[{"actionKey":"hit","actionType":"EXECUTE_EFFECT","detail":{"effectKey":"damage"}}]}
            """.formatted(step));
    }
    private static Aggregate aggregate(SourceType type, String key, String data) {
        return new Aggregate(type, "spell", key, AggregateJson.tree(data));
    }
}
