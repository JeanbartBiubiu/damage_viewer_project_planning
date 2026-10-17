package xyz.game.datamanage.support.authoring;

import java.util.List;
import java.util.Map;
import xyz.game.datamanage.model.modifierzone.ModifierZoneCalculationMode;

/** 剩余比例连乘只接受增加属性比例，不从属性或技能名称推断用途。 */
public final class AttributeComplementMultiplySemantics {
    private AttributeComplementMultiplySemantics() {}

    public static void addReferenceIssues(ModifierZoneCalculationMode mode, String resultType, String operation,
                                         String zoneField, String operationField, List<Map<String, String>> issues) {
        if (mode != ModifierZoneCalculationMode.RATIO_COMPLEMENT_MULTIPLY) return;
        if (!"ATTRIBUTE_CHANGE".equals(resultType)) {
            issues.add(Map.of("field", zoneField, "code", "CALCULATION_MODE_INVALID", "message", "剩余比例连乘只允许属性变化引用"));
        } else if (!"INCREASE".equals(operation)) {
            issues.add(Map.of("field", operationField, "code", "OPERATION_INVALID", "message", "剩余比例连乘只允许增加操作"));
        }
    }
}
