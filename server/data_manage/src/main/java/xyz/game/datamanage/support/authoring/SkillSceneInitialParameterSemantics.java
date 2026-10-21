package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.error.ApiException;

/** 场景值由宿主明确供给；管理端只保护声明、实际消费及初始化入口。 */
public final class SkillSceneInitialParameterSemantics {
    private SkillSceneInitialParameterSemantics() {}
    private static final BigDecimal MAX_SAFE_INTEGER = new BigDecimal("9007199254740991");

    public static List<Map<String, String>> detailIssues(JsonNode detail, String valueType, String path) {
        if (detail == null || !detail.isObject()) return List.of(issue(path, "TYPE_MISMATCH", "场景显式初值明细必须是对象"));
        List<Map<String, String>> issues = new ArrayList<>();
        detail.fieldNames().forEachRemaining(field -> {
            if (!Set.of("minValue", "maxValue", "sharedInputKey").contains(field)) issues.add(issue(path + "." + field,
                "UNKNOWN_FIELD", "场景显式初值不接受默认值或其它明细"));
        });
        if (detail.has("sharedInputKey") && (!detail.path("sharedInputKey").isTextual()
            || !detail.path("sharedInputKey").textValue().matches("^[a-z][a-z0-9_]{0,63}$"))) {
            issues.add(issue(path + ".sharedInputKey", "VALUE_SHAPE_INVALID", "共享输入标识必须是明确的合法标识"));
        }
        for (String field : List.of("minValue", "maxValue")) {
            JsonNode node = detail.path(field);
            if (!node.isNumber() || !Double.isFinite(node.doubleValue())) {
                issues.add(issue(path + "." + field, "REQUIRED", "必须声明有限的初值边界"));
            } else if ("INTEGER".equals(valueType) && (node.decimalValue().stripTrailingZeros().scale() > 0
                || node.decimalValue().abs().compareTo(MAX_SAFE_INTEGER) > 0)) {
                issues.add(issue(path + "." + field, "RANGE_INVALID", "整数初值边界必须是安全整数"));
            }
        }
        if (detail.path("minValue").isNumber() && detail.path("maxValue").isNumber()
            && detail.path("minValue").decimalValue().compareTo(detail.path("maxValue").decimalValue()) > 0) {
            issues.add(issue(path + ".minValue", "RANGE_INVALID", "最小初值不能大于最大初值"));
        }
        return List.copyOf(issues);
    }

    public static boolean entryAllowed(String eventType, String actionType, String targetContext) {
        return "SOURCE_INITIALIZED".equals(eventType) && "EXECUTE_EFFECT".equals(actionType)
            && "EVENT_SOURCE".equals(targetContext);
    }

    public static boolean startEntryAllowed(String skillKey, String eventType, String sourceSkillKey, String useKind,
                                           String castPhase, String actionType, String activationType) {
        return SkillSceneAttributeSnapshotSemantics.entryAllowed(skillKey, eventType, sourceSkillKey,
            useKind, castPhase, actionType, activationType);
    }

    public static void validateBinding(Aggregate rule, JsonNode action, Aggregate process, JsonNode binding, String valueType, String path) {
        var issues = detailIssues(binding.path("detail"), valueType, path + ".detail");
        if (!issues.isEmpty()) throw invalid(rule, issues.getFirst());
        JsonNode event = rule.data().path("eventSource");
        if (startEntryAllowed(rule.skillKey(), event.path("eventType").asText(), event.path("detail").path("sourceSkillKey").asText(),
                event.path("detail").path("useKind").asText(), event.path("detail").path("castPhase").asText(),
                action.path("actionType").asText(), process == null ? "" : process.data().path("activationType").asText())) return;
        if (!entryAllowed(event.path("eventType").asText(), action.path("actionType").asText(),
                action.path("targetContext").asText()) || !event.path("detail").isObject()
                || !event.path("detail").isEmpty()) {
            throw invalid(rule, issue(path + ".sourceType", "EVENT_VALUE_NOT_AVAILABLE",
                "场景显式初值只授权自身初始化或本技能明确首次主动过程负载"));
        }
    }

    private static Map<String, String> issue(String field, String code, String message) {
        return Map.of("field", field, "code", code, "message", message);
    }

    private static ApiException invalid(Aggregate rule, Map<String, String> issue) {
        var fields = new java.util.LinkedHashMap<>(issue);
        fields.put("sourceSkillKey", rule.skillKey());
        fields.put("sourceType", rule.type().name());
        fields.put("sourceKey", rule.key());
        return new ApiException(HttpStatus.BAD_REQUEST, "400.INVALID_SKILL_NUMERIC_VALUE", issue.get("message"),
            Map.of("fieldIssues", List.of(fields)));
    }
}
