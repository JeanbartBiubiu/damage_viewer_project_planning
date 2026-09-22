package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import xyz.game.datamanage.model.skillprocess.SkillProcessActivationType;
import xyz.game.datamanage.model.skillprocess.SkillProcessStepType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCastPhase;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

/**
 * 施放阶段、推进动作与过程激活类型的最终关系语义。
 * 未修改的缺阶段存量不单独构成全局拒绝；任意 ADVANCE_PROCESS 不能因阶段空缺豁免。
 */
public final class SkillCastingPhaseSemantics {
    private SkillCastingPhaseSemantics() {
    }

    public static void validate(List<Aggregate> aggregates) {
        Map<String, ProcessShape> processes = indexProcesses(aggregates);
        for (Aggregate aggregate : aggregates) {
            if (aggregate.type() != SourceType.TRIGGER) {
                continue;
            }
            JsonNode data = aggregate.data();
            JsonNode event = data.path("eventSource");
            String eventType = text(event, "eventType");
            JsonNode detail = event.path("detail");
            String castPhase = optionalText(detail, "castPhase");
            boolean skillUsed = "SKILL_USED".equals(eventType);
            boolean explicitPhase = skillUsed && castPhase != null;
            JsonNode actions = data.path("actions");
            List<Map<String, String>> issues = new ArrayList<>();
            if ("SKILL_HIT".equals(eventType) && optionalText(detail, "castPhase") != null) {
                issues.add(issue("eventSource.detail.castPhase", "FORBIDDEN", "技能命中事件不能提供使用阶段"));
            }
            for (int i = 0; i < actions.size(); i++) {
                JsonNode action = actions.get(i);
                String actionType = text(action, "actionType");
                String prefix = "actions[" + i + "]";
                if ("ADVANCE_PROCESS".equals(actionType)) {
                    issues.addAll(advanceIssues(aggregate, detail, action, prefix, processes, skillUsed, castPhase));
                } else if ("START_PROCESS".equals(actionType) && explicitPhase
                    && !"INITIAL".equals(castPhase)) {
                    issues.add(issue(
                        prefix + ".actionType",
                        "REFERENCE_TYPE_MISMATCH",
                        "已核定使用阶段的技能使用事件只能在首次阶段启动过程"
                    ));
                }
            }
            if (!issues.isEmpty()) {
                throw conflict(aggregate, "施放阶段或推进过程与当前配置不匹配", issues);
            }
        }
    }

    private static List<Map<String, String>> advanceIssues(
        Aggregate aggregate,
        JsonNode eventDetail,
        JsonNode action,
        String prefix,
        Map<String, ProcessShape> processes,
        boolean skillUsed,
        String castPhase
    ) {
        List<Map<String, String>> issues = new ArrayList<>();
        JsonNode detail = action.path("detail");
        String processKey = optionalText(detail, "processKey");
        String stepKey = optionalText(detail, "stepKey");
        if (!skillUsed) {
            issues.add(issue(prefix + ".actionType", "EVENT_VALUE_NOT_AVAILABLE", "推进过程只允许用于技能使用事件"));
            return issues;
        }
        String sourceSkill = optionalText(eventDetail, "sourceSkillKey");
        if (sourceSkill == null) {
            issues.add(issue("eventSource.detail.sourceSkillKey", "REQUIRED", "推进过程必须明确来源技能"));
        } else if (!sourceSkill.equals(aggregate.skillKey())) {
            issues.add(issue("eventSource.detail.sourceSkillKey", "REFERENCE_TYPE_MISMATCH", "推进过程只能引用当前技能"));
        }
        if (castPhase == null) {
            issues.add(issue("eventSource.detail.castPhase", "REQUIRED", "推进过程必须核定使用阶段"));
            return issues;
        }
        SkillTriggerCastPhase phase;
        try {
            phase = SkillTriggerCastPhase.valueOf(castPhase);
        } catch (IllegalArgumentException ex) {
            issues.add(issue("eventSource.detail.castPhase", "INVALID", "使用阶段不合法"));
            return issues;
        }
        if (phase == SkillTriggerCastPhase.INITIAL) {
            issues.add(issue("eventSource.detail.castPhase", "REFERENCE_TYPE_MISMATCH", "首次阶段不能推进已有过程"));
            return issues;
        }
        if (processKey == null) {
            issues.add(issue(prefix + ".detail.processKey", "REQUIRED", "过程标识不能为空"));
            return issues;
        }
        if (stepKey == null) {
            issues.add(issue(prefix + ".detail.stepKey", "REQUIRED", "步骤标识不能为空"));
            return issues;
        }
        ProcessShape process = processes.get(aggregate.skillKey() + "/" + processKey);
        if (process == null) {
            issues.add(issue(prefix + ".detail.processKey", "UNKNOWN_PROCESS", "过程不存在或不属于当前技能"));
            return issues;
        }
        if (process.activationType() == SkillProcessActivationType.PASSIVE) {
            issues.add(issue(prefix + ".detail.processKey", "REFERENCE_TYPE_MISMATCH", "推进过程不能指向被动过程"));
        }
        SkillProcessStepType stepType = process.steps().get(stepKey);
        if (stepType == null) {
            issues.add(issue(prefix + ".detail.stepKey", "UNKNOWN_STEP", "步骤不存在或不属于当前过程"));
            return issues;
        }
        SkillProcessStepType expected = phase == SkillTriggerCastPhase.RECAST
            ? SkillProcessStepType.RECAST
            : SkillProcessStepType.CHARGE;
        if (stepType != expected) {
            issues.add(issue(prefix + ".detail.stepKey", "REFERENCE_TYPE_MISMATCH", "推进步骤种类与使用阶段不匹配"));
        }
        return issues;
    }

    private static Map<String, ProcessShape> indexProcesses(List<Aggregate> aggregates) {
        Map<String, ProcessShape> indexed = new LinkedHashMap<>();
        for (Aggregate aggregate : aggregates) {
            if (aggregate.type() != SourceType.PROCESS) {
                continue;
            }
            SkillProcessActivationType activation = null;
            String raw = optionalText(aggregate.data(), "activationType");
            if (raw != null) {
                try {
                    activation = SkillProcessActivationType.valueOf(raw);
                } catch (IllegalArgumentException ignored) {
                    activation = null;
                }
            }
            Map<String, SkillProcessStepType> steps = new LinkedHashMap<>();
            for (JsonNode step : aggregate.data().path("steps")) {
                String stepKey = optionalText(step, "stepKey");
                String stepType = optionalText(step, "stepType");
                if (stepKey == null || stepType == null) {
                    continue;
                }
                try {
                    steps.put(stepKey, SkillProcessStepType.valueOf(stepType));
                } catch (IllegalArgumentException ignored) {
                    // 步骤种类合法性由过程服务负责。
                }
            }
            indexed.put(aggregate.skillKey() + "/" + aggregate.key(), new ProcessShape(activation, steps));
        }
        return indexed;
    }

    private static ApiException conflict(Aggregate source, String message, List<Map<String, String>> issues) {
        List<Map<String, String>> located = issues.stream().map(issue -> {
            Map<String, String> row = new LinkedHashMap<>(issue);
            row.put("sourceSkillKey", source.skillKey());
            row.put("sourceType", source.type().name());
            row.put("sourceKey", source.key());
            return row;
        }).toList();
        return new ApiException(
            HttpStatus.CONFLICT,
            "409.SKILL_OBJECT_REFERENCE_INVALID",
            message,
            Map.of("fieldIssues", located)
        );
    }

    private static Map<String, String> issue(String field, String code, String message) {
        return Map.of("field", field, "code", code, "message", message);
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node == null ? null : node.get(field);
        return value == null || value.isNull() || !value.isTextual() ? "" : value.asText();
    }

    private static String optionalText(JsonNode node, String field) {
        JsonNode value = node == null ? null : node.get(field);
        if (value == null || value.isNull() || value.isMissingNode() || !value.isTextual()) {
            return null;
        }
        String trimmed = value.asText().trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private record ProcessShape(SkillProcessActivationType activationType, Map<String, SkillProcessStepType> steps) {
    }
}
