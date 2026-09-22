package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import xyz.game.datamanage.model.modifierzone.ModifierZoneCalculationMode;
import xyz.game.datamanage.model.modifierzone.ModifierZoneDomain;
import xyz.game.datamanage.model.skilleffect.SkillEffectHealingModifierDirection;
import xyz.game.datamanage.model.skilleffect.SkillEffectModifierOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultType;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

/**
 * 比例减少取强乘区的引用组合：真实 calculationMode 与治疗修正方向、操作必须同时匹配。
 * SkillEffect 保存锁行与同游戏最终配置检查共用此规则，不按乘区名称推断。
 */
public final class HealingRatioMaxSemantics {
    private final JdbcTemplate jdbc;

    public HealingRatioMaxSemantics(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void validate(String gameId, List<Aggregate> aggregates) {
        validate(aggregates, readZones(jdbc, gameId));
    }

    public static Map<String, Zone> readZones(JdbcTemplate jdbc, String gameId) {
        Map<String, Zone> zones = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbc.queryForList(ZONES_SQL, gameId)) {
            String key = (String) row.get("modifier_zone_key");
            zones.put(key, new Zone(
                key,
                parseDomain(row.get("domain")),
                parseMode(row.get("calculation_mode"))
            ));
        }
        return zones;
    }

    public static void validate(List<Aggregate> aggregates, Map<String, Zone> zones) {
        List<Map<String, String>> issues = new ArrayList<>();
        for (Aggregate aggregate : aggregates) {
            if (aggregate.type() != SourceType.EFFECT) {
                continue;
            }
            int index = 0;
            for (JsonNode result : aggregate.data().path("results")) {
                String prefix = "results[" + index++ + "]";
                JsonNode detail = result.path("detail");
                String zoneKey = optionalText(detail, "modifierZoneKey");
                if (zoneKey == null) {
                    continue;
                }
                Zone zone = zones.get(zoneKey);
                if (zone == null || zone.calculationMode() != ModifierZoneCalculationMode.RATIO_MAX) {
                    continue;
                }
                List<Map<String, String>> located = new ArrayList<>();
                addReferenceIssues(
                    zone.calculationMode(),
                    optionalText(result, "resultType"),
                    optionalText(detail, "direction"),
                    optionalText(detail, "operation"),
                    prefix + ".detail.modifierZoneKey",
                    prefix + ".detail.direction",
                    prefix + ".detail.operation",
                    located
                );
                for (Map<String, String> issue : located) {
                    Map<String, String> row = new LinkedHashMap<>(issue);
                    row.put("sourceSkillKey", aggregate.skillKey());
                    row.put("sourceType", aggregate.type().name());
                    row.put("sourceKey", aggregate.key());
                    issues.add(row);
                }
            }
        }
        if (!issues.isEmpty()) {
            throw new ApiException(
                HttpStatus.CONFLICT,
                "409.SKILL_OBJECT_REFERENCE_INVALID",
                "比例减少取强乘区与治疗修正组合不合法",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
    }

    public static void addReferenceIssues(
        ModifierZoneCalculationMode calculationMode,
        String resultType,
        String direction,
        String operation,
        String calculationModeField,
        String directionField,
        String operationField,
        List<Map<String, String>> issues
    ) {
        if (calculationMode != ModifierZoneCalculationMode.RATIO_MAX) {
            return;
        }
        if (!SkillEffectResultType.HEALING_MODIFIER.name().equals(resultType)) {
            issues.add(issue(calculationModeField, "CALCULATION_MODE_INVALID", "比例减少取强只允许治疗修正引用"));
            return;
        }
        if (!SkillEffectHealingModifierDirection.RECEIVED.name().equals(direction)) {
            issues.add(issue(directionField, "DIRECTION_INVALID", "比例减少取强只允许受到治疗方向"));
        }
        if (!SkillEffectModifierOperation.DECREASE.name().equals(operation)) {
            issues.add(issue(operationField, "OPERATION_INVALID", "比例减少取强只允许降低操作"));
        }
    }

    public record Zone(
        String modifierZoneKey,
        ModifierZoneDomain domain,
        ModifierZoneCalculationMode calculationMode
    ) {
    }

    static final String ZONES_SQL = """
        SELECT modifier_zone_key, domain, calculation_mode
        FROM public.modifier_zones
        WHERE game_id = ?
        ORDER BY modifier_zone_key
        """;

    private static ModifierZoneDomain parseDomain(Object value) {
        if (value == null) {
            return null;
        }
        try {
            return ModifierZoneDomain.valueOf(value.toString());
        } catch (IllegalArgumentException ex) {
            return null;
        }
    }

    private static ModifierZoneCalculationMode parseMode(Object value) {
        if (value == null) {
            return null;
        }
        try {
            return ModifierZoneCalculationMode.valueOf(value.toString());
        } catch (IllegalArgumentException ex) {
            return null;
        }
    }

    private static Map<String, String> issue(String field, String code, String message) {
        return Map.of("field", field, "code", code, "message", message);
    }

    private static String optionalText(JsonNode node, String field) {
        JsonNode value = node == null ? null : node.get(field);
        if (value == null || value.isNull() || value.isMissingNode() || !value.isTextual()) {
            return null;
        }
        String trimmed = value.asText().trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
