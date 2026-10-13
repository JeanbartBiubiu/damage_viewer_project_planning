package xyz.game.datamanage.model.modifierzone;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import org.junit.jupiter.api.Test;

class ModifierZoneCombinationsTest {
    @Test
    void multiplicationOnlyAcceptsAttributePercentageStage() {
        assertTrue(ModifierZoneCombinations.isLegal(ModifierZoneDomain.ATTRIBUTE,
            ModifierZoneCalculationMode.RATIO_MULTIPLY, ModifierZoneApplicationStage.ATTRIBUTE_PERCENT));
        assertFalse(ModifierZoneCombinations.isLegal(ModifierZoneDomain.ATTRIBUTE,
            ModifierZoneCalculationMode.RATIO_MULTIPLY, ModifierZoneApplicationStage.ATTRIBUTE_FLAT));
        assertFalse(ModifierZoneCombinations.isLegal(ModifierZoneDomain.HEALING,
            ModifierZoneCalculationMode.RATIO_MULTIPLY, ModifierZoneApplicationStage.HEALING_RESULT));
        assertFalse(ModifierZoneCombinations.isLegal(ModifierZoneDomain.DAMAGE,
            ModifierZoneCalculationMode.RATIO_MULTIPLY, ModifierZoneApplicationStage.DAMAGE_POST_DEFENSE));
        assertFalse(ModifierZoneCombinations.isLegal(ModifierZoneDomain.SHIELD,
            ModifierZoneCalculationMode.RATIO_MULTIPLY, ModifierZoneApplicationStage.SHIELD_RESULT));
    }
}
