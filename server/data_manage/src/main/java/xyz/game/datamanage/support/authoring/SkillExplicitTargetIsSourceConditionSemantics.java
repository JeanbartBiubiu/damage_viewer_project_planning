package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerExplicitTargetIsSourceConditionDetail;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

/** 显式自施目标条件只检查技能使用事件在目标回退前是否明确携带了与来源对象相同的目标。 */
public final class SkillExplicitTargetIsSourceConditionSemantics {
    private SkillExplicitTargetIsSourceConditionSemantics() { }

    public static List<Map<String, String>> shapeIssues(
        SkillTriggerExplicitTargetIsSourceConditionDetail detail,
        String path
    ) {
        return detail.unknownFields().stream()
            .map(field -> issue(path + "." + field, "UNKNOWN_FIELD", "未知显式自施目标条件字段"))
            .toList();
    }

    public static List<Map<String, String>> eventIssues(SkillTriggerEventType eventType, String path) {
        if (eventType == SkillTriggerEventType.SKILL_USED) {
            return List.of();
        }
        return List.of(issue(path, "EVENT_VALUE_NOT_AVAILABLE", "显式自施目标条件只适用于技能使用事件"));
    }

    public static void validate(List<Aggregate> aggregates) {
        for (Aggregate aggregate : aggregates) {
            if (aggregate.type() != SourceType.TRIGGER) {
                continue;
            }
            int groupIndex = 0;
            for (JsonNode group : aggregate.data().path("conditionGroups")) {
                int conditionIndex = 0;
                for (JsonNode condition : group.path("conditions")) {
                    if ("EXPLICIT_TARGET_IS_SOURCE".equals(condition.path("conditionType").asText())) {
                        validateCondition(aggregate, condition, groupIndex, conditionIndex);
                    }
                    conditionIndex++;
                }
                groupIndex++;
            }
        }
    }

    private static void validateCondition(
        Aggregate aggregate,
        JsonNode condition,
        int groupIndex,
        int conditionIndex
    ) {
        String path = "conditionGroups[" + groupIndex + "].conditions[" + conditionIndex + "].detail";
        List<Map<String, String>> issues = new ArrayList<>();
        try {
            SkillTriggerExplicitTargetIsSourceConditionDetail detail = AggregateJson.read(
                condition.path("detail").toString(),
                SkillTriggerExplicitTargetIsSourceConditionDetail.class
            );
            if (detail == null) {
                issues.add(issue(path, "REQUIRED", "显式自施目标条件明细不能为空"));
            } else {
                issues.addAll(shapeIssues(detail, path));
            }
            SkillTriggerEventType eventType = SkillTriggerEventType.valueOf(
                aggregate.data().path("eventSource").path("eventType").asText()
            );
            issues.addAll(eventIssues(eventType, path));
        } catch (IllegalStateException | IllegalArgumentException ex) {
            issues.add(issue(path, "VALUE_SHAPE_INVALID", "显式自施目标条件或所属事件形状不合法"));
        }
        if (issues.isEmpty()) {
            return;
        }
        List<Map<String, String>> located = issues.stream().map(issue -> {
            Map<String, String> row = new LinkedHashMap<>(issue);
            row.put("sourceSkillKey", aggregate.skillKey());
            row.put("sourceType", "TRIGGER");
            row.put("sourceKey", aggregate.key());
            return row;
        }).toList();
        throw new ApiException(
            HttpStatus.BAD_REQUEST,
            "400.INVALID_SKILL_TRIGGER_RULE_REFERENCE",
            "显式自施目标条件与当前配置不匹配",
            Map.of("fieldIssues", located)
        );
    }

    private static Map<String, String> issue(String field, String code, String message) {
        return Map.of("field", field, "code", code, "message", message);
    }
}
