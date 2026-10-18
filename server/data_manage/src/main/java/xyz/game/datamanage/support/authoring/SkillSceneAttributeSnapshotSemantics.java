package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

/** 场景属性快照只声明来源；管理端不猜测所选场景的实际值。 */
public final class SkillSceneAttributeSnapshotSemantics {
    private SkillSceneAttributeSnapshotSemantics() {}

    public record Attribute(String status, String valueType) {}

    public static List<Map<String, String>> detailIssues(JsonNode detail, String path) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (detail == null || !detail.isObject()) return List.of(issue(path, "TYPE_MISMATCH", "场景属性快照明细必须是对象"));
        detail.fieldNames().forEachRemaining(field -> {
            if (!Set.of("subject", "attributeKey", "sources").contains(field)) {
                issues.add(issue(path + "." + field, "UNKNOWN_FIELD", "场景属性快照明细包含未知字段"));
            }
        });
        if (!detail.path("subject").isTextual()
            || !Set.of("SOURCE", "TARGET").contains(detail.path("subject").textValue())) {
            issues.add(issue(path + ".subject", "REQUIRED", "必须明确场景攻击方或目标方槽位"));
        }
        if (!detail.path("attributeKey").isTextual()
            || !detail.path("attributeKey").textValue().matches("^[a-z][a-z0-9_]{0,63}$")) {
            issues.add(issue(path + ".attributeKey", "REQUIRED", "必须明确合法的场景属性标识"));
        }
        JsonNode sources = detail.path("sources");
        if (!sources.isArray() || sources.isEmpty()) {
            issues.add(issue(path + ".sources", "REQUIRED", "场景属性来源必须是非空数组"));
        } else {
            Set<String> seen = new LinkedHashSet<>();
            int index = 0;
            for (JsonNode source : sources) {
                String value = source.isTextual() ? source.textValue() : "";
                if (!Set.of("CHARACTER_LEVEL", "EQUIPMENT_DIRECT").contains(value)) {
                    issues.add(issue(path + ".sources[" + index + "]", "ENUM_INVALID", "场景属性来源不受支持"));
                } else if (!seen.add(value)) {
                    issues.add(issue(path + ".sources[" + index + "]", "DUPLICATE", "场景属性来源不能重复"));
                }
                index++;
            }
        }
        return List.copyOf(issues);
    }

    public static boolean entryAllowed(String skillKey, String eventType, String sourceSkillKey, String useKind,
                                       String castPhase, String actionType, String activationType) {
        return "SKILL_USED".equals(eventType) && skillKey.equals(sourceSkillKey)
            && "ACTIVE".equals(useKind) && "INITIAL".equals(castPhase)
            && "START_PROCESS".equals(actionType) && "ACTIVE".equals(activationType);
    }

    public static void validateBinding(Aggregate rule, JsonNode action, Aggregate process, JsonNode binding, String path) {
        List<Map<String, String>> issues = detailIssues(binding.path("detail"), path + ".detail");
        if (!issues.isEmpty()) throw invalid(rule, issues.getFirst());
        JsonNode event = rule.data().path("eventSource");
        JsonNode eventDetail = event.path("detail");
        if (!entryAllowed(rule.skillKey(), event.path("eventType").asText(), eventDetail.path("sourceSkillKey").asText(),
                eventDetail.path("useKind").asText(), eventDetail.path("castPhase").asText(), action.path("actionType").asText(),
                process == null ? "" : process.data().path("activationType").asText())) {
            throw invalid(rule, issue(path + ".sourceType", "EVENT_VALUE_NOT_AVAILABLE",
                "场景属性快照只允许本技能明确首次主动使用启动真实主动过程"));
        }
    }

    public static List<Map<String, String>> attributeIssues(Attribute attribute, String path) {
        if (attribute == null) return List.of(issue(path, "UNKNOWN_ATTRIBUTE", "场景属性不存在或不属于当前游戏"));
        if (!"ENABLED".equals(attribute.status())) return List.of(issue(path, "ATTRIBUTE_DISABLED", "场景属性必须启用"));
        if (!"INTEGER".equals(attribute.valueType()) && !"DECIMAL".equals(attribute.valueType())) {
            return List.of(issue(path, "REFERENCE_TYPE_MISMATCH", "场景属性快照只能读取数值属性"));
        }
        return List.of();
    }

    public static void validateAttributes(List<Aggregate> sources, Map<String, Attribute> attributes) {
        for (Aggregate rule : sources) {
            if (rule.type() != SourceType.TRIGGER) continue;
            int actionIndex = 0;
            for (JsonNode action : rule.data().path("actions")) {
                int bindingIndex = 0;
                for (JsonNode binding : action.path("runtimeInputBindings")) {
                    if ("SCENE_ATTRIBUTE_SNAPSHOT".equals(binding.path("sourceType").asText())) {
                        String path = "actions[" + actionIndex + "].runtimeInputBindings[" + bindingIndex + "].detail.attributeKey";
                        var issues = attributeIssues(attributes.get(binding.path("detail").path("attributeKey").asText()), path);
                        if (!issues.isEmpty()) throw invalid(rule, issues.getFirst());
                    }
                    bindingIndex++;
                }
                actionIndex++;
            }
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
        return new ApiException(HttpStatus.BAD_REQUEST, "400.INVALID_SKILL_NUMERIC_VALUE",
            issue.get("message"), Map.of("fieldIssues", List.of(fields)));
    }
}
