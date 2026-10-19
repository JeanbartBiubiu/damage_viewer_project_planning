package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import xyz.game.datamanage.support.authoring.SkillNumericSemantics.Parameter;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.*;
import xyz.game.datamanage.support.error.ApiException;

class SkillCooldownDurationSemanticsTest {
    @ParameterizedTest @ValueSource(strings = {"0.5", "1", "2", "0.0001"})
    void staticPositiveMultipliersAreNotRemainingCooldownRatios(String number) {
        var effect = CooldownDurationTestData.effect();
        rule(effect).set("value", CooldownDurationTestData.fixed(number));
        assertDoesNotThrow(() -> validate(effect, List.of()));
    }

    @ParameterizedTest @ValueSource(strings = {"0", "-0.5", "1e1000", "1e-1000"})
    void invalidOrUnrepresentableEffectiveMultiplierIsRejected(String number) {
        var effect = CooldownDurationTestData.effect();
        rule(effect).set("value", CooldownDurationTestData.fixed(number));
        assertThrows(ApiException.class, () -> validate(effect, List.of()));
    }

    @Test void finalClampAndMultiplierAreAppliedToTheWholeStaticValue() {
        var effect = CooldownDurationTestData.effect();
        rule(effect).put("fixedMultiplier", 0);
        assertThrows(ApiException.class, () -> validate(effect, List.of()));
        rule(effect).put("fixedMinValue", .25);
        assertDoesNotThrow(() -> validate(effect, List.of()));
        rule(effect).put("fixedMinValue", 0); rule(effect).put("fixedMaxValue", 0);
        assertThrows(ApiException.class, () -> validate(effect, List.of()));
    }

    @ParameterizedTest @ValueSource(strings = {"SKILL_LEVEL", "CHARACTER_LEVEL"})
    void everyLevelAndParameterMutationIsChecked(String mode) {
        var effect = CooldownDurationTestData.effect();
        rule(effect).set("value", AggregateJson.tree("{\"kind\":\"PARAMETER\",\"parameterKey\":\"factor\"}"));
        assertDoesNotThrow(() -> validate(effect, List.of(new Parameter("caster_skill", "factor", "DECIMAL", mode,
            null, AggregateJson.tree("{\"1\":0.5,\"2\":1}")))));
        assertThrows(ApiException.class, () -> validate(effect, List.of(new Parameter("caster_skill", "factor", "DECIMAL", mode,
            null, AggregateJson.tree("{\"1\":0.5,\"2\":0}")))));
        assertThrows(ApiException.class, () -> validate(effect, List.of(new Parameter("caster_skill", "factor", "DECIMAL", "RUNTIME_INPUT", null, null))));
    }

    @Test void completeStaticFormulaIsAcceptedButAttributeMutationCannotBecomeDynamic() {
        var effect = CooldownDurationTestData.effect();
        rule(effect).set("value", AggregateJson.tree("{\"kind\":\"FORMULA\",\"formulaKey\":\"factor\"}"));
        ObjectNode definition = (ObjectNode) AggregateJson.tree("""
            {"expression":{"inputs":[],"stages":[{"key":"out","name":"倍率","expression":{"op":"div","args":[
             {"op":"const","value":"1"},{"op":"const","value":"2"}]}}],"outputStageKey":"out"}}
            """);
        var formula = new Aggregate(SourceType.FORMULA, "caster_skill", "factor", definition);
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(CooldownDurationTestData.aggregate(effect), formula), List.of()));
        ((com.fasterxml.jackson.databind.node.ArrayNode) definition.path("expression").path("inputs")).add(AggregateJson.tree("""
            {"key":"dynamic","binding":{"kind":"attribute","object":"source","attributeKey":"armor","valueKind":"TOTAL","view":"current_frame"}}
            """));
        ((ObjectNode) definition.path("expression").path("stages").get(0)).set("expression", AggregateJson.tree("{\"op\":\"read\",\"inputKey\":\"dynamic\"}"));
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(CooldownDurationTestData.aggregate(effect), formula), List.of()));
    }

    @ParameterizedTest @ValueSource(strings = {"durationValue", "maxStacksValue", "applicationStacksValue"})
    void lifecycleMustBeStaticFiniteAndExactlySingleLayer(String field) {
        var effect = CooldownDurationTestData.effect();
        ((ObjectNode) effect.path("lifecycle")).set(field, CooldownDurationTestData.fixed(field.equals("durationValue") ? "0" : "2"));
        assertThrows(ApiException.class, () -> validate(effect, List.of()));
        ((ObjectNode) effect.path("lifecycle")).set(field, AggregateJson.tree("{\"kind\":\"PARAMETER\",\"parameterKey\":\"dynamic\"}"));
        assertThrows(ApiException.class, () -> validate(effect, List.of(new Parameter("caster_skill", "dynamic", "INTEGER", "RUNTIME_INPUT", null, null))));
    }

    @Test void effectShapeRequiresSourceSnapshotAndTheSpecificRefreshPolicy() {
        var effect = CooldownDurationTestData.effect();
        for (String field : List.of("target", "lifecycleBehavior", "spellShieldBlockScope")) {
            var copy = effect.deepCopy();
            ObjectNode result = (ObjectNode) copy.path("results").get(0);
            if (field.equals("target")) result.put(field, "TARGET");
            else if (field.equals("spellShieldBlockScope")) result.put(field, "RESULT");
            else ((ObjectNode) result.path(field)).put("reapplicationValueMode", "KEEP");
            assertThrows(ApiException.class, () -> validate(copy, List.of()));
        }
        for (String field : List.of("instanceScope", "expiryMode", "reapplicationDurationMode")) {
            var copy = effect.deepCopy();
            ((ObjectNode) copy.path("lifecycle")).put(field, "OTHER");
            assertThrows(ApiException.class, () -> validate(copy, List.of()));
        }
    }

    @Test void scopeReferencesAreRealSkillsAndMissingTargetsAreRejected() {
        var aggregate = CooldownDurationTestData.aggregate(CooldownDurationTestData.effect());
        var reference = new Target(TargetType.SKILL, "", "target_skill", "");
        var refs = SkillObjectReferences.extractAndValidate("lol", List.of(aggregate), Set.of(reference));
        assertTrue(refs.stream().anyMatch(row -> row.target().equals(reference)
            && row.fieldPath().contains("affectedSkillScope.skillKeys[0]")));
        assertThrows(ApiException.class, () -> SkillObjectReferences.extractAndValidate("lol", List.of(aggregate), Set.of()));
        for (String keys : List.of("[]", "[\"target_skill\",\"target_skill\"]", "[\"bad key\"]")) {
            var copy = CooldownDurationTestData.effect();
            ((ObjectNode) copy.path("results").get(0).path("detail").path("affectedSkillScope")).set("skillKeys", AggregateJson.tree(keys));
            assertThrows(ApiException.class, () -> validate(copy, List.of()));
        }
    }

    @Test void triggerResultModifierCannotTurnTheMultiplierIntoZero() {
        var effect = CooldownDurationTestData.aggregate(CooldownDurationTestData.effect());
        var rule = new Aggregate(SourceType.TRIGGER, "caster_skill", "apply", AggregateJson.tree("""
            {"eventSource":{"eventType":"SOURCE_INITIALIZED","detail":{}},"conditionGroups":[],
             "actions":[{"actionType":"EXECUTE_EFFECT","detail":{"effectKey":"buff"},"targetContext":"EVENT_SOURCE",
              "runtimeInputBindings":[],"resultModifiers":[{"resultKey":"duration","fixedMultiplier":0,"fixedMinValue":null,"fixedMaxValue":null}]}]}
            """));
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(effect, rule), List.of()));
    }

    private static ObjectNode rule(ObjectNode effect) { return (ObjectNode) effect.path("results").get(0).path("valueRule"); }
    private static void validate(ObjectNode effect, List<Parameter> parameters) {
        SkillNumericSemantics.validate(List.of(CooldownDurationTestData.aggregate(effect)), parameters, Map.of());
    }
}
