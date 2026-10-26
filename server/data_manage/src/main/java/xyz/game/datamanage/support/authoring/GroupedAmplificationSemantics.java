package xyz.game.datamanage.support.authoring;

import java.util.List;
import java.util.Map;
import xyz.game.datamanage.model.modifierzone.ModifierZoneApplicationStage;
import xyz.game.datamanage.model.modifierzone.ModifierZoneCalculationMode;
import xyz.game.datamanage.model.modifierzone.ModifierZoneCombinations;
import xyz.game.datamanage.model.modifierzone.ModifierZoneDomain;

/** 同组增幅复用真实乘区标识；只声明作者边界，不在后端执行分组计算。 */
public final class GroupedAmplificationSemantics {
    private GroupedAmplificationSemantics() {}

    public static void addReferenceIssues(ModifierZoneDomain domain, ModifierZoneCalculationMode mode,
        ModifierZoneApplicationStage stage, String resultType, String direction, String operation,
        String criticalFilter, String prefix, List<Map<String, String>> issues) {
        if (mode != ModifierZoneCalculationMode.RATIO_GROUP_ADD) return;
        if (!ModifierZoneCombinations.isLegal(domain, mode, stage)
            || domain == ModifierZoneDomain.ATTRIBUTE && !"ATTRIBUTE_CHANGE".equals(resultType)
            || domain == ModifierZoneDomain.DAMAGE && !"DAMAGE_MODIFIER".equals(resultType)) {
            issue(issues, prefix + ".detail.modifierZoneKey", "CALCULATION_MODE_INVALID", "同组增幅只支持属性整体比例或伤害防御前后乘区");
            return;
        }
        if (!"INCREASE".equals(operation)) {
            issue(issues, prefix + ".detail.operation", "OPERATION_INVALID", "同组增幅只允许增加操作");
        }
        if (domain == ModifierZoneDomain.DAMAGE) {
            String expected = stage == ModifierZoneApplicationStage.DAMAGE_PRE_DEFENSE ? "DEALT" : "TAKEN";
            if (!expected.equals(direction)) {
                issue(issues, prefix + ".detail.direction", "DIRECTION_INVALID", "防御前同组增幅使用造成方向，防御后使用承受方向");
            }
            if (!"ANY".equals(criticalFilter)) {
                issue(issues, prefix + ".detail.criticalFilter", "CRITICAL_FILTER_INVALID", "同组增幅不支持仅暴击或仅非暴击部分");
            }
        }
    }

    public static void addReferenceIssues(String domain, String mode, String stage, String resultType,
        String direction, String operation, String criticalFilter, String prefix, List<Map<String, String>> issues) {
        if (!"RATIO_GROUP_ADD".equals(mode)) return;
        ModifierZoneDomain parsedDomain;
        ModifierZoneApplicationStage parsedStage;
        try {
            parsedDomain = ModifierZoneDomain.valueOf(domain == null ? "" : domain);
            parsedStage = ModifierZoneApplicationStage.valueOf(stage == null ? "" : stage);
        } catch (IllegalArgumentException ex) {
            issue(issues, prefix + ".detail.modifierZoneKey", "CALCULATION_MODE_INVALID", "同组增幅需要完整且合法的乘区作用域与阶段");
            return;
        }
        addReferenceIssues(parsedDomain, ModifierZoneCalculationMode.RATIO_GROUP_ADD, parsedStage,
            resultType, direction, operation, criticalFilter, prefix, issues);
    }

    private static void issue(List<Map<String, String>> issues, String field, String code, String message) {
        issues.add(Map.of("field", field, "code", code, "message", message));
    }
}
