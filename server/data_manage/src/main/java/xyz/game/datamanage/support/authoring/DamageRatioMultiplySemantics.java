package xyz.game.datamanage.support.authoring;

import java.util.List;
import java.util.Map;
import xyz.game.datamanage.model.modifierzone.ModifierZoneCalculationMode;
import xyz.game.datamanage.model.modifierzone.ModifierZoneDomain;

/** 防御后承受减伤将比例 r 映射成 1-r，再按来源连乘。 */
public final class DamageRatioMultiplySemantics {
    private DamageRatioMultiplySemantics() {}

    public static void addReferenceIssues(ModifierZoneDomain domain, ModifierZoneCalculationMode mode,
                                         String resultType, String direction, String operation,
                                         String zoneField, String directionField, String operationField,
                                         List<Map<String, String>> issues) {
        if (domain != ModifierZoneDomain.DAMAGE || mode != ModifierZoneCalculationMode.RATIO_MULTIPLY) return;
        if (!"DAMAGE_MODIFIER".equals(resultType)) {
            issues.add(Map.of("field", zoneField, "code", "CALCULATION_MODE_INVALID", "message", "防御后减伤连乘只允许伤害修正引用"));
        } else if (!"TAKEN".equals(direction)) {
            issues.add(Map.of("field", directionField, "code", "DIRECTION_INVALID", "message", "防御后减伤连乘只允许承受方向"));
        } else if (!"DECREASE".equals(operation)) {
            issues.add(Map.of("field", operationField, "code", "OPERATION_INVALID", "message", "防御后减伤连乘只允许减少操作"));
        }
    }
}
