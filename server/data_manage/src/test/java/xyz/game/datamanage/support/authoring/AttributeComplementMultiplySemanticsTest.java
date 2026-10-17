package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.*;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.model.modifierzone.ModifierZoneCalculationMode;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

class AttributeComplementMultiplySemanticsTest {
    private static Aggregate effect(String type, String operation, String value) {
        return new Aggregate(SourceType.EFFECT, "spell", "bonus", AggregateJson.tree("""
            {"results":[{"resultKey":"bonus","resultType":"%s","target":"SOURCE","detail":{"operation":"%s","modifierZoneKey":"complement"},
             "valueRule":{"value":{"kind":"FIXED","value":%s}}}]}
            """.formatted(type, operation, value)));
    }
    private static void validate(Aggregate effect) {
        SkillNumericSemantics.validate(List.of(effect), List.of(), Map.of("complement", "RATIO_COMPLEMENT_MULTIPLY"));
    }
    @Test void onlyIncreasingAttributeRatiosAreAllowedInTheClosedInterval() {
        for (String value : List.of("0", "0.1", "0.4", "1"))
            assertDoesNotThrow(() -> validate(effect("ATTRIBUTE_CHANGE", "INCREASE", value)));
        for (String value : List.of("-0.01", "1.00000000000000000000000001", "2"))
            assertThrows(ApiException.class, () -> validate(effect("ATTRIBUTE_CHANGE", "INCREASE", value)));
        assertThrows(ApiException.class, () -> validate(effect("ATTRIBUTE_CHANGE", "DECREASE", "0.1")));
        assertThrows(ApiException.class, () -> validate(effect("DAMAGE_MODIFIER", "INCREASE", "0.1")));
    }
    @Test void directReferenceAndFinalAggregateValidationShareTheSameRestriction() {
        List<Map<String, String>> issues = new ArrayList<>();
        AttributeComplementMultiplySemantics.addReferenceIssues(ModifierZoneCalculationMode.RATIO_COMPLEMENT_MULTIPLY,
            "ATTRIBUTE_CHANGE", "DECREASE", "zone", "operation", issues);
        assertEquals("operation", issues.getFirst().get("field"));
        assertEquals("OPERATION_INVALID", issues.getFirst().get("code"));
        issues.clear();
        AttributeComplementMultiplySemantics.addReferenceIssues(ModifierZoneCalculationMode.RATIO_ADD,
            "ATTRIBUTE_CHANGE", "DECREASE", "zone", "operation", issues);
        assertTrue(issues.isEmpty());
    }
    @Test void effectiveFixedMultiplierAndBoundsAreAppliedBeforeCheckingTheRange() {
        Aggregate candidate = effect("ATTRIBUTE_CHANGE", "INCREASE", "0.6");
        ((com.fasterxml.jackson.databind.node.ObjectNode) candidate.data().path("results").get(0).path("valueRule"))
            .put("fixedMultiplier", 2);
        assertThrows(ApiException.class, () -> validate(candidate));
        ((com.fasterxml.jackson.databind.node.ObjectNode) candidate.data().path("results").get(0).path("valueRule"))
            .put("fixedMaxValue", 1);
        assertDoesNotThrow(() -> validate(candidate));
    }
}
