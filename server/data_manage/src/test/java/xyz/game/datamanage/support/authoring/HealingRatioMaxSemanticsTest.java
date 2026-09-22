package xyz.game.datamanage.support.authoring;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.model.modifierzone.ModifierZoneCalculationMode;
import xyz.game.datamanage.model.modifierzone.ModifierZoneDomain;
import xyz.game.datamanage.support.authoring.HealingRatioMaxSemantics.Zone;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

class HealingRatioMaxSemanticsTest {
    @Test
    void ratioAddKeepsDoneAndIncrease() {
        assertDoesNotThrow(() -> HealingRatioMaxSemantics.validate(
            List.of(effect("HEALING_MODIFIER", "DONE", "INCREASE")),
            Map.of("foo", zone(ModifierZoneCalculationMode.RATIO_ADD))
        ));
    }

    @Test
    void ratioMaxRequiresReceivedDecreaseHealingModifier() {
        ApiException damage = assertThrows(ApiException.class, () -> HealingRatioMaxSemantics.validate(
            List.of(effect("DAMAGE_MODIFIER", "RECEIVED", "DECREASE")),
            Map.of("foo", zone(ModifierZoneCalculationMode.RATIO_MAX))
        ));
        assertEquals("409.SKILL_OBJECT_REFERENCE_INVALID", damage.getCode());
        assertField(damage, "results[0].detail.modifierZoneKey", "CALCULATION_MODE_INVALID");

        ApiException done = assertThrows(ApiException.class, () -> HealingRatioMaxSemantics.validate(
            List.of(effect("HEALING_MODIFIER", "DONE", "DECREASE")),
            Map.of("foo", zone(ModifierZoneCalculationMode.RATIO_MAX))
        ));
        assertField(done, "results[0].detail.direction", "DIRECTION_INVALID");

        ApiException increase = assertThrows(ApiException.class, () -> HealingRatioMaxSemantics.validate(
            List.of(effect("HEALING_MODIFIER", "RECEIVED", "INCREASE")),
            Map.of("foo", zone(ModifierZoneCalculationMode.RATIO_MAX))
        ));
        assertField(increase, "results[0].detail.operation", "OPERATION_INVALID");

        assertDoesNotThrow(() -> HealingRatioMaxSemantics.validate(
            List.of(effect("HEALING_MODIFIER", "RECEIVED", "DECREASE")),
            Map.of("foo", zone(ModifierZoneCalculationMode.RATIO_MAX))
        ));
    }

    @Test
    void doesNotInferModeFromZoneName() {
        assertDoesNotThrow(() -> HealingRatioMaxSemantics.validate(
            List.of(named("grievous_wounds", "HEALING_MODIFIER", "DONE", "INCREASE")),
            Map.of("grievous_wounds", new Zone("grievous_wounds", ModifierZoneDomain.HEALING, ModifierZoneCalculationMode.RATIO_ADD))
        ));
        ApiException error = assertThrows(ApiException.class, () -> HealingRatioMaxSemantics.validate(
            List.of(named("ordinary", "HEALING_MODIFIER", "DONE", "DECREASE")),
            Map.of("ordinary", zone(ModifierZoneCalculationMode.RATIO_MAX))
        ));
        assertField(error, "results[0].detail.direction", "DIRECTION_INVALID");
    }

    private static Zone zone(ModifierZoneCalculationMode mode) {
        return new Zone("foo", ModifierZoneDomain.HEALING, mode);
    }

    private static Aggregate effect(String resultType, String direction, String operation) {
        return named("foo", resultType, direction, operation);
    }

    private static Aggregate named(String zoneKey, String resultType, String direction, String operation) {
        return new Aggregate(SourceType.EFFECT, "skill", "effect", AggregateJson.tree("""
            {"results":[{"resultKey":"mod","resultType":"%s","detail":{
              "modifierZoneKey":"%s","direction":"%s","operation":"%s","healingKind":"ANY"}}]}
            """.formatted(resultType, zoneKey, direction, operation)));
    }

    @SuppressWarnings("unchecked")
    private static void assertField(ApiException error, String field, String code) {
        List<Map<String, String>> issues = (List<Map<String, String>>) error.getDetails().get("fieldIssues");
        assertTrue(issues.stream().anyMatch(issue -> field.equals(issue.get("field")) && code.equals(issue.get("code"))),
            () -> "expected " + field + "/" + code + " but was " + issues);
    }
}
