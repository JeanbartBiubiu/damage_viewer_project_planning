package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

class GroupedAmplificationSemanticsTest {
    private static Aggregate effect(String type, String operation, String direction, String value) {
        return new Aggregate(SourceType.EFFECT, "spell", "amplification", AggregateJson.tree("""
            {"results":[{"resultKey":"amp","resultType":"%s","target":"SOURCE",
             "detail":{"modifierZoneKey":"grouped","operation":"%s","direction":"%s","criticalFilter":"ANY"},
             "valueRule":{"value":{"kind":"FIXED","value":%s}}}]}
            """.formatted(type, operation, direction, value)));
    }
    private static void validate(String domain, String stage, Aggregate... objects) {
        SkillNumericSemantics.validate(List.of(objects), List.of(), Map.of("grouped", "RATIO_GROUP_ADD"),
            Map.of("grouped", domain), Map.of("grouped", stage));
    }
    private static ObjectNode rule(Aggregate effect) {
        return (ObjectNode) effect.data().path("results").get(0).path("valueRule");
    }

    @Test void nonNegativeRatiosAreNeutralAtZeroAndMayExceedOne() {
        for (String value : List.of("0", "0.2", "1", "2.5")) {
            assertDoesNotThrow(() -> validate("ATTRIBUTE", "ATTRIBUTE_PERCENT", effect("ATTRIBUTE_CHANGE", "INCREASE", "", value)));
            assertDoesNotThrow(() -> validate("DAMAGE", "DAMAGE_PRE_DEFENSE", effect("DAMAGE_MODIFIER", "INCREASE", "DEALT", value)));
            assertDoesNotThrow(() -> validate("DAMAGE", "DAMAGE_POST_DEFENSE", effect("DAMAGE_MODIFIER", "INCREASE", "TAKEN", value)));
        }
    }

    @Test void decreaseAndReversedDirectionsDoNotBecomeGroupedAmplification() {
        assertThrows(ApiException.class, () -> validate("ATTRIBUTE", "ATTRIBUTE_PERCENT", effect("ATTRIBUTE_CHANGE", "DECREASE", "", "0.2")));
        assertThrows(ApiException.class, () -> validate("DAMAGE", "DAMAGE_PRE_DEFENSE", effect("DAMAGE_MODIFIER", "INCREASE", "TAKEN", "0.2")));
        assertThrows(ApiException.class, () -> validate("DAMAGE", "DAMAGE_POST_DEFENSE", effect("DAMAGE_MODIFIER", "INCREASE", "DEALT", "0.2")));
        assertThrows(ApiException.class, () -> validate("DAMAGE", "DAMAGE_POST_DEFENSE", effect("DAMAGE_MODIFIER", "DECREASE", "TAKEN", "-0.2")));
        Aggregate critical = effect("DAMAGE_MODIFIER", "INCREASE", "TAKEN", "0.2");
        ((ObjectNode) critical.data().path("results").get(0).path("detail")).put("criticalFilter", "CRITICAL_ONLY");
        assertThrows(ApiException.class, () -> validate("DAMAGE", "DAMAGE_POST_DEFENSE", critical));
    }

    @Test void rawNegativeValuesCannotBeHiddenByDoubleSignsOrClamps() {
        assertThrows(ApiException.class, () -> validate("ATTRIBUTE", "ATTRIBUTE_PERCENT", effect("ATTRIBUTE_CHANGE", "INCREASE", "", "1e400")));
        for (String field : List.of("fixedMultiplier", "fixedMinValue", "fixedMaxValue")) {
            Aggregate candidate = effect("ATTRIBUTE_CHANGE", "INCREASE", "", "-0.2");
            rule(candidate).put(field, field.equals("fixedMultiplier") ? -1 : 0);
            assertThrows(ApiException.class, () -> validate("ATTRIBUTE", "ATTRIBUTE_PERCENT", candidate), field);
        }
        Aggregate candidate = effect("ATTRIBUTE_CHANGE", "INCREASE", "", "0");
        rule(candidate).put("fixedMultiplier", -1);
        assertThrows(ApiException.class, () -> validate("ATTRIBUTE", "ATTRIBUTE_PERCENT", candidate));
    }

    @Test void effectiveValuesAndAllDeclaredLevelsMustStayFiniteAndNonNegative() {
        Aggregate candidate = effect("ATTRIBUTE_CHANGE", "INCREASE", "", "0.2");
        rule(candidate).put("fixedMaxValue", new BigDecimal("-0.1"));
        assertThrows(ApiException.class, () -> validate("ATTRIBUTE", "ATTRIBUTE_PERCENT", candidate));
        rule(candidate).remove("fixedMaxValue");
        rule(candidate).put("fixedMultiplier", new BigDecimal("1e400"));
        assertThrows(ApiException.class, () -> validate("ATTRIBUTE", "ATTRIBUTE_PERCENT", candidate));
        rule(candidate).remove("fixedMultiplier");
        rule(candidate).set("value", AggregateJson.tree("{\"kind\":\"PARAMETER\",\"parameterKey\":\"ratio\"}"));
        var valid = new SkillNumericSemantics.Parameter("spell", "ratio", "DECIMAL", "SKILL_LEVEL", null,
            AggregateJson.tree("{\"1\":0,\"2\":0.2,\"3\":2.5}"));
        var invalid = new SkillNumericSemantics.Parameter("spell", "ratio", "DECIMAL", "SKILL_LEVEL", null,
            AggregateJson.tree("{\"1\":0,\"2\":0.2,\"3\":-0.001}"));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(candidate), List.of(valid), Map.of("grouped", "RATIO_GROUP_ADD"),
            Map.of("grouped", "ATTRIBUTE"), Map.of("grouped", "ATTRIBUTE_PERCENT")));
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(candidate), List.of(invalid), Map.of("grouped", "RATIO_GROUP_ADD"),
            Map.of("grouped", "ATTRIBUTE"), Map.of("grouped", "ATTRIBUTE_PERCENT")));
    }

    @Test void actionResultModifiersAreCheckedAfterTheBaseRule() {
        Aggregate effect = effect("DAMAGE_MODIFIER", "INCREASE", "DEALT", "0.2");
        Aggregate action = new Aggregate(SourceType.TRIGGER, "spell", "apply", AggregateJson.tree("""
            {"actions":[{"actionType":"EXECUTE_EFFECT","detail":{"effectKey":"amplification"},
             "runtimeInputBindings":[],"resultModifiers":[{"resultKey":"amp","fixedMultiplier":2}]}]}
            """));
        assertDoesNotThrow(() -> validate("DAMAGE", "DAMAGE_PRE_DEFENSE", effect, action));
        ObjectNode modifier = (ObjectNode) action.data().path("actions").get(0).path("resultModifiers").get(0);
        modifier.put("fixedMultiplier", -1);
        modifier.put("fixedMinValue", 0);
        assertThrows(ApiException.class, () -> validate("DAMAGE", "DAMAGE_PRE_DEFENSE", effect, action));
        modifier.put("fixedMultiplier", 1);
        modifier.remove("fixedMinValue");
        modifier.put("fixedMaxValue", -1);
        assertThrows(ApiException.class, () -> validate("DAMAGE", "DAMAGE_PRE_DEFENSE", effect, action));
        modifier.remove("fixedMaxValue");
        modifier.put("fixedMultiplier", new BigDecimal("1e400"));
        assertThrows(ApiException.class, () -> validate("DAMAGE", "DAMAGE_PRE_DEFENSE", effect, action));
    }

    @Test void everyCatalogAndConsumerBoundaryRejectsUnsupportedNewGroupsOnly() {
        List<Map<String, String>> issues = new ArrayList<>();
        GroupedAmplificationSemantics.addReferenceIssues("HEALING", "RATIO_GROUP_ADD", "HEALING_RESULT", "HEALING_MODIFIER",
            "RECEIVED", "INCREASE", "ANY", "results[0]", issues);
        assertEquals("results[0].detail.modifierZoneKey", issues.getFirst().get("field"));
        issues.clear();
        GroupedAmplificationSemantics.addReferenceIssues("DAMAGE", "RATIO_ADD", "DAMAGE_PRE_DEFENSE", "DAMAGE_MODIFIER",
            "TAKEN", "DECREASE", "CRITICAL_ONLY", "results[0]", issues);
        assertTrue(issues.isEmpty());
        assertThrows(ApiException.class, () -> validate("ATTRIBUTE", "ATTRIBUTE_FLAT", effect("ATTRIBUTE_CHANGE", "INCREASE", "", "0.2")));
    }

    @Test void dynamicRuntimeParametersAreNotAdmittedAsStaticAuthorRatios() {
        Aggregate candidate = effect("ATTRIBUTE_CHANGE", "INCREASE", "", "0.2");
        rule(candidate).set("value", AggregateJson.tree("{\"kind\":\"PARAMETER\",\"parameterKey\":\"ratio\"}"));
        var runtime = new SkillNumericSemantics.Parameter("spell", "ratio", "DECIMAL", "RUNTIME_INPUT", null, null);
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(candidate), List.of(runtime),
            Map.of("grouped", "RATIO_GROUP_ADD"), Map.of("grouped", "ATTRIBUTE"), Map.of("grouped", "ATTRIBUTE_PERCENT")));
    }
}
