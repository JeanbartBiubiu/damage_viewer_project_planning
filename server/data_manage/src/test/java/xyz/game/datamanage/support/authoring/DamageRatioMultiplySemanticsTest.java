package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.model.modifierzone.ModifierZoneCalculationMode;
import xyz.game.datamanage.model.modifierzone.ModifierZoneDomain;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

class DamageRatioMultiplySemanticsTest {
    private static Aggregate effect(String direction, String operation, String value) {
        return new Aggregate(SourceType.EFFECT, "guard", "reduction", AggregateJson.tree("""
            {"results":[{"resultKey":"mitigation","resultType":"DAMAGE_MODIFIER","target":"SOURCE",
             "detail":{"direction":"%s","operation":"%s","modifierZoneKey":"multiply"},
             "valueRule":{"value":{"kind":"FIXED","value":%s}}}]}
            """.formatted(direction, operation, value)));
    }
    private static void validate(Aggregate effect) {
        SkillNumericSemantics.validate(List.of(effect), List.of(), Map.of("multiply", "RATIO_MULTIPLY"),
            Map.of("multiply", "DAMAGE"), Map.of("multiply", "DAMAGE_POST_DEFENSE"));
    }
    @Test void acceptsOnlyTakenDecreaseAndExactClosedUnitRange() {
        for (String value : List.of("0", "0.25", "0.41", "1"))
            assertDoesNotThrow(() -> validate(effect("TAKEN", "DECREASE", value)));
        for (String value : List.of("-0.01", "1.00000000000000000000000001", "2"))
            assertThrows(ApiException.class, () -> validate(effect("TAKEN", "DECREASE", value)));
        assertThrows(ApiException.class, () -> validate(effect("DEALT", "DECREASE", "0.25")));
        assertThrows(ApiException.class, () -> validate(effect("TAKEN", "INCREASE", "0.25")));
    }
    @Test void effectiveValueRuleIsCheckedRatherThanOnlyTheRawConstant() {
        Aggregate candidate = effect("TAKEN", "DECREASE", "0.6");
        ObjectNode rule = (ObjectNode) candidate.data().path("results").get(0).path("valueRule");
        rule.put("fixedMultiplier", 2);
        assertThrows(ApiException.class, () -> validate(candidate));
        rule.put("fixedMaxValue", 1);
        assertDoesNotThrow(() -> validate(candidate));
    }
    @Test void sameModeInAttributeDomainAndExistingAdditiveDamageAreUnchanged() {
        List<Map<String, String>> issues = new ArrayList<>();
        DamageRatioMultiplySemantics.addReferenceIssues(ModifierZoneDomain.ATTRIBUTE, ModifierZoneCalculationMode.RATIO_MULTIPLY,
            "ATTRIBUTE_CHANGE", "", "INCREASE", "zone", "direction", "operation", issues);
        DamageRatioMultiplySemantics.addReferenceIssues(ModifierZoneDomain.DAMAGE, ModifierZoneCalculationMode.RATIO_ADD,
            "DAMAGE_MODIFIER", "DEALT", "INCREASE", "zone", "direction", "operation", issues);
        assertTrue(issues.isEmpty());
        DamageRatioMultiplySemantics.addReferenceIssues(ModifierZoneDomain.DAMAGE, ModifierZoneCalculationMode.RATIO_MULTIPLY,
            "DAMAGE_MODIFIER", "DEALT", "DECREASE", "zone", "direction", "operation", issues);
        assertEquals("direction", issues.getFirst().get("field"));
    }
    @Test void everyDeclaredRankAndActionModifierMustStayInsideTheUnitInterval() {
        Aggregate candidate = effect("TAKEN", "DECREASE", "0.6");
        ObjectNode rule = (ObjectNode) candidate.data().path("results").get(0).path("valueRule");
        rule.set("value", AggregateJson.tree("{\"kind\":\"PARAMETER\",\"parameterKey\":\"ratio\"}"));
        var valid = new SkillNumericSemantics.Parameter("guard", "ratio", "DECIMAL", "SKILL_LEVEL", null,
            AggregateJson.tree("{\"1\":0.25,\"2\":0.29,\"3\":0.33,\"4\":0.37,\"5\":0.41}"));
        var invalid = new SkillNumericSemantics.Parameter("guard", "ratio", "DECIMAL", "SKILL_LEVEL", null,
            AggregateJson.tree("{\"1\":0.25,\"2\":0.29,\"3\":0.33,\"4\":0.37,\"5\":1.001}"));
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(List.of(candidate), List.of(valid), Map.of("multiply", "RATIO_MULTIPLY")));
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(List.of(candidate), List.of(invalid), Map.of("multiply", "RATIO_MULTIPLY")));
        Aggregate modified = new Aggregate(SourceType.TRIGGER, "guard", "cast", AggregateJson.tree("""
            {"actions":[{"actionType":"EXECUTE_EFFECT","detail":{"effectKey":"reduction"},
             "runtimeInputBindings":[],"resultModifiers":[{"resultKey":"mitigation","fixedMultiplier":2}]}]}
            """));
        assertThrows(ApiException.class, () -> SkillNumericSemantics.validate(
            List.of(effect("TAKEN", "DECREASE", "0.6"), modified), List.of(), Map.of("multiply", "RATIO_MULTIPLY")));
        ((ObjectNode) modified.data().path("actions").get(0).path("resultModifiers").get(0)).put("fixedMaxValue", BigDecimal.ONE);
        assertDoesNotThrow(() -> SkillNumericSemantics.validate(
            List.of(effect("TAKEN", "DECREASE", "0.6"), modified), List.of(), Map.of("multiply", "RATIO_MULTIPLY")));
    }
}
