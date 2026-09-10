package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerTargetCategory;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerTargetCategoryConditionDetail;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

/** 类别筛选当前事件目标；击杀事件读取被击杀对象，命中事件读取实际命中对象，不读取属性或产生执行依赖。 */
public final class SkillTargetCategoryConditionSemantics {
    private SkillTargetCategoryConditionSemantics() { }

    public static List<Map<String, String>> shapeIssues(SkillTriggerTargetCategoryConditionDetail detail, String path) {
        List<Map<String, String>> issues = new ArrayList<>();
        for (String field : detail.unknownFields()) issues.add(issue(path + "." + field, "UNKNOWN_FIELD", "未知事件目标类别条件字段"));
        if (detail.categories() == null || detail.categories().isEmpty()) {
            issues.add(issue(path + ".categories", "REQUIRED", "至少选择一种事件目标类别"));
            return issues;
        }
        Set<SkillTriggerTargetCategory> unique = new HashSet<>();
        for (int i = 0; i < detail.categories().size(); i++) {
            SkillTriggerTargetCategory category = detail.categories().get(i);
            if (category == null) issues.add(issue(path + ".categories[" + i + "]", "UNKNOWN_CATEGORY", "事件目标类别不能为空"));
            else if (!unique.add(category)) issues.add(issue(path + ".categories[" + i + "]", "DUPLICATE", "事件目标类别不能重复"));
        }
        return issues;
    }

    public static List<Map<String, String>> eventIssues(SkillTriggerEventType eventType, String path) {
        if (eventType == SkillTriggerEventType.SKILL_HIT
            || eventType == SkillTriggerEventType.BASIC_ATTACK_HIT
            || eventType == SkillTriggerEventType.KILL) return List.of();
        return List.of(issue(path + ".categories", "EVENT_VALUE_NOT_AVAILABLE",
            "事件目标类别只适用于技能命中、普攻命中或来源对象完成击杀事件"));
    }

    public static void validate(List<Aggregate> aggregates) {
        for (Aggregate aggregate : aggregates) if (aggregate.type() == SourceType.TRIGGER) {
            int g = 0;
            for (JsonNode group : aggregate.data().path("conditionGroups")) {
                int c = 0;
                for (JsonNode condition : group.path("conditions")) {
                    if ("TARGET_CATEGORY_CHECK".equals(condition.path("conditionType").asText())) {
                        String path = "conditionGroups[" + g + "].conditions[" + c + "].detail";
                        List<Map<String, String>> issues = new ArrayList<>();
                        try {
                            SkillTriggerTargetCategoryConditionDetail detail = AggregateJson.read(condition.path("detail").toString(), SkillTriggerTargetCategoryConditionDetail.class);
                            if (detail == null) issues.add(issue(path, "REQUIRED", "事件目标类别明细不能为空"));
                            else issues.addAll(shapeIssues(detail, path));
                            issues.addAll(eventIssues(SkillTriggerEventType.valueOf(aggregate.data().path("eventSource").path("eventType").asText()), path));
                        } catch (IllegalStateException | IllegalArgumentException ex) {
                            issues.add(issue(path, "VALUE_SHAPE_INVALID", "事件目标类别或所属事件形状不合法"));
                        }
                        if (!issues.isEmpty()) {
                            List<Map<String, String>> located = issues.stream().map(issue -> {
                                Map<String, String> row = new LinkedHashMap<>(issue);
                                row.put("sourceSkillKey", aggregate.skillKey()); row.put("sourceType", "TRIGGER"); row.put("sourceKey", aggregate.key());
                                return row;
                            }).toList();
                            throw new ApiException(HttpStatus.BAD_REQUEST, "400.INVALID_SKILL_TRIGGER_RULE_REFERENCE",
                                "事件目标类别条件与当前配置不匹配", Map.of("fieldIssues", located));
                        }
                    }
                    c++;
                }
                g++;
            }
        }
    }

    private static Map<String, String> issue(String field, String code, String message) {
        return Map.of("field", field, "code", code, "message", message);
    }
}
