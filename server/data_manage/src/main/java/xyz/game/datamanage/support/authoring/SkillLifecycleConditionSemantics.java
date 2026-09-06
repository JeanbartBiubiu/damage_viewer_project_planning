package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleInstanceScope;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventCapabilities;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleCheckKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSubject;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

/** 生命周期条件只读取实例；保存和最终事务状态共用相同的形状及主体校验。 */
public final class SkillLifecycleConditionSemantics {
    private SkillLifecycleConditionSemantics() { }

    public static List<Map<String, String>> shapeIssues(SkillTriggerLifecycleConditionDetail detail, String path) {
        List<Map<String, String>> issues = new ArrayList<>();
        for (String field : detail.unknownFields()) issues.add(issue(path + "." + field, "UNKNOWN_FIELD", "未知生命周期条件字段"));
        if (detail.effectKey() == null) issues.add(issue(path + ".effectKey", "REQUIRED", "生命周期效果不能为空"));
        if (detail.checkKind() == null) issues.add(issue(path + ".checkKind", "REQUIRED", "生命周期检查方式不能为空"));
        else if (detail.checkKind() == SkillTriggerLifecycleCheckKind.STACKS_COMPARE) {
            if (detail.comparator() == null) issues.add(issue(path + ".comparator", "REQUIRED", "层数比较必须指定比较符"));
            if (detail.comparisonValue() == null) issues.add(issue(path + ".comparisonValue", "REQUIRED", "层数比较必须指定比较值"));
        } else {
            if (detail.comparator() != null) issues.add(issue(path + ".comparator", "FORBIDDEN", "存在检查不能指定比较符"));
            if (detail.comparisonValue() != null) issues.add(issue(path + ".comparisonValue", "FORBIDDEN", "存在检查不能指定比较值"));
        }
        return issues;
    }

    public static List<Map<String, String>> subjectIssues(SkillTriggerLifecycleConditionDetail detail,
            SkillEffectLifecycleInstanceScope scope, SkillTriggerEventType eventType, String path) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (scope == null) {
            issues.add(issue(path + ".effectKey", "UNKNOWN_LIFECYCLE", "效果必须属于当前技能且已经配置生命周期"));
            return issues;
        }
        boolean needsSubject = scope == SkillEffectLifecycleInstanceScope.TARGET || scope == SkillEffectLifecycleInstanceScope.SOURCE_TARGET;
        if (needsSubject && detail.subject() == null) issues.add(issue(path + ".subject", "REQUIRED", "该生命周期范围必须指定承受对象"));
        if (!needsSubject && detail.subject() != null) issues.add(issue(path + ".subject", "FORBIDDEN", "该生命周期范围不能指定承受对象"));
        if (detail.subject() == SkillTriggerSubject.EVENT_SOURCE && !SkillTriggerEventCapabilities.hasEventSource(eventType)) {
            issues.add(issue(path + ".subject", "EVENT_SOURCE_NOT_AVAILABLE", "当前事件不提供事件来源对象"));
        }
        return issues;
    }

    public static void validate(List<Aggregate> aggregates) {
        Map<String, JsonNode> lifecycles = new LinkedHashMap<>();
        for (Aggregate a : aggregates) if (a.type() == SourceType.EFFECT) {
            lifecycles.put(a.skillKey() + "/" + a.key(), a.data().path("lifecycle"));
        }
        for (Aggregate a : aggregates) if (a.type() == SourceType.TRIGGER) {
            int g = 0;
            for (JsonNode group : a.data().path("conditionGroups")) {
                int c = 0;
                for (JsonNode condition : group.path("conditions")) {
                    if ("LIFECYCLE_CHECK".equals(condition.path("conditionType").asText())) {
                        String path = "conditionGroups[" + g + "].conditions[" + c + "].detail";
                        SkillTriggerLifecycleConditionDetail detail = AggregateJson.read(condition.path("detail").toString(), SkillTriggerLifecycleConditionDetail.class);
                        JsonNode life = lifecycles.get(a.skillKey() + "/" + detail.effectKey());
                        String scopeName = life == null ? null : life.path("instanceScope").textValue();
                        SkillEffectLifecycleInstanceScope scope = scopeName == null ? null : SkillEffectLifecycleInstanceScope.valueOf(scopeName);
                        SkillTriggerEventType event = SkillTriggerEventType.valueOf(a.data().path("eventSource").path("eventType").asText());
                        List<Map<String, String>> issues = new ArrayList<>(shapeIssues(detail, path));
                        issues.addAll(subjectIssues(detail, scope, event, path));
                        if (!issues.isEmpty()) {
                            List<Map<String, String>> located = issues.stream().map(issue -> {
                                Map<String, String> row = new LinkedHashMap<>(issue);
                                row.put("sourceSkillKey", a.skillKey()); row.put("sourceType", "TRIGGER"); row.put("sourceKey", a.key());
                                return row;
                            }).toList();
                            throw new ApiException(HttpStatus.BAD_REQUEST, "400.INVALID_SKILL_TRIGGER_RULE_REFERENCE",
                                "生命周期条件与当前配置不匹配", Map.of("fieldIssues", located));
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
