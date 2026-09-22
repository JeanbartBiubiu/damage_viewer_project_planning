package xyz.game.datamanage.model.modifierzone;

/** 乘区作用域、计算方式与应用阶段的唯一合法组合。 */
public final class ModifierZoneCombinations {
    private ModifierZoneCombinations() {
    }

    public static boolean isLegal(
        ModifierZoneDomain domain,
        ModifierZoneCalculationMode mode,
        ModifierZoneApplicationStage stage
    ) {
        if (domain == null || mode == null || stage == null) {
            return false;
        }
        return switch (domain) {
            case ATTRIBUTE -> (mode == ModifierZoneCalculationMode.FLAT_ADD
                    && stage == ModifierZoneApplicationStage.ATTRIBUTE_FLAT)
                || (mode == ModifierZoneCalculationMode.RATIO_ADD
                    && stage == ModifierZoneApplicationStage.ATTRIBUTE_PERCENT);
            case DAMAGE -> mode == ModifierZoneCalculationMode.RATIO_ADD
                && (stage == ModifierZoneApplicationStage.DAMAGE_PRE_DEFENSE
                    || stage == ModifierZoneApplicationStage.DAMAGE_POST_DEFENSE);
            case HEALING -> (mode == ModifierZoneCalculationMode.RATIO_ADD
                    || mode == ModifierZoneCalculationMode.RATIO_MAX)
                && stage == ModifierZoneApplicationStage.HEALING_RESULT;
            case SHIELD -> mode == ModifierZoneCalculationMode.RATIO_ADD
                && stage == ModifierZoneApplicationStage.SHIELD_RESULT;
        };
    }
}
