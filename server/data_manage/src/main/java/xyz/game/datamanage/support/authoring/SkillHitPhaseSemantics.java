package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.springframework.http.HttpStatus;
import xyz.game.datamanage.model.skillprocess.SkillProcessMomentType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSkillHitProcessMoment;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

/** 实际命中阶段按最终过程和完整规则组检查，不依赖请求数组或规则写入顺序。 */
public final class SkillHitPhaseSemantics {
    private static final String PATH = "eventSource.detail.processMoment";
    private static final Set<String> PHASE_FIELDS = Set.of("processKey", "moment", "requiresPriorStepKey");
    private static final Set<String> MOMENT_FIELDS = Set.of("momentType", "stepKey");

    private SkillHitPhaseSemantics() {}

    public static List<Map<String, String>> shapeIssues(SkillTriggerSkillHitProcessMoment phase, String path) {
        if (phase == null) return List.of();
        List<Map<String, String>> issues = new ArrayList<>();
        for (String field : phase.unknownFields()) issues.add(issue(path + "." + field, "UNKNOWN_FIELD", "命中阶段包含未知字段"));
        if (phase.processKey() == null) issues.add(issue(path + ".processKey", "REQUIRED", "命中阶段必须指定过程"));
        if (phase.moment() == null) issues.add(issue(path + ".moment", "REQUIRED", "命中阶段必须指定步骤执行时点"));
        else {
            if (phase.moment().momentType() != SkillProcessMomentType.STEP_EXECUTION)
                issues.add(issue(path + ".moment.momentType", "REFERENCE_TYPE_MISMATCH", "命中阶段只允许步骤执行时点"));
            if (phase.moment().stepKey() == null) issues.add(issue(path + ".moment.stepKey", "REQUIRED", "命中阶段必须指定步骤"));
            if (phase.moment().failureReason() != null)
                issues.add(issue(path + ".moment.failureReason", "FORBIDDEN", "命中阶段不能指定失败原因"));
            for (String field : phase.moment().unknownFields())
                issues.add(issue(path + ".moment." + field, "UNKNOWN_FIELD", "命中阶段时点包含未知字段"));
        }
        if (!phase.requiresPriorStepKeyPresent())
            issues.add(issue(path + ".requiresPriorStepKey", "REQUIRED", "必须明确前置命中步骤或空值"));
        else if (phase.requiresPriorStepKeyInvalid())
            issues.add(issue(path + ".requiresPriorStepKey", "VALUE_SHAPE_INVALID", "前置命中步骤必须为空值或非空步骤标识"));
        return issues;
    }

    public static void validate(List<Aggregate> sources, List<Aggregate> context) {
        Set<String> skills = new LinkedHashSet<>();
        sources.forEach(source -> skills.add(source.skillKey()));
        for (String skill : skills) validateSkill(skill, context);
    }

    private static void validateSkill(String skill, List<Aggregate> context) {
        List<Aggregate> rules = context.stream().filter(a -> a.type() == SourceType.TRIGGER && skill.equals(a.skillKey())).toList();
        Map<String, List<Phase>> phases = new LinkedHashMap<>();
        List<Map<String, String>> issues = new ArrayList<>();
        for (Aggregate rule : rules) {
            JsonNode event = rule.data().path("eventSource");
            JsonNode detail = event.path("detail");
            if (!detail.has("processMoment")) continue;
            JsonNode raw = detail.path("processMoment");
            List<Map<String, String>> shape = rawShape(raw);
            if (!"SKILL_HIT".equals(text(event, "eventType")))
                shape.add(issue(PATH, "FORBIDDEN", "只有技能实际命中事件可以指定命中阶段"));
            if (!skill.equals(text(detail, "sourceSkillKey")))
                shape.add(issue("eventSource.detail.sourceSkillKey", "REFERENCE_TYPE_MISMATCH", "显式命中阶段必须明确属于当前技能"));
            if (rule.data().path("actions").isEmpty())
                shape.add(issue("actions", "REQUIRED", "命中阶段不能没有动作"));
            shape.forEach(row -> issues.add(located(row, rule)));
            if (!shape.isEmpty()) continue;
            Phase phase = new Phase(rule, text(raw, "processKey"), text(raw.path("moment"), "stepKey"), text(raw, "requiresPriorStepKey"));
            phases.computeIfAbsent(phase.process(), ignored -> new ArrayList<>()).add(phase);
        }
        if (phases.isEmpty()) {
            reject(issues);
            return;
        }
        Set<String> initialProcesses = new LinkedHashSet<>();
        for (Aggregate rule : rules) {
            JsonNode event = rule.data().path("eventSource");
            JsonNode detail = event.path("detail");
            if (!"SKILL_USED".equals(text(event, "eventType")) || !skill.equals(text(detail, "sourceSkillKey"))
                || !"ACTIVE".equals(text(detail, "useKind")) || !"INITIAL".equals(text(detail, "castPhase"))) continue;
            for (JsonNode action : rule.data().path("actions")) {
                if ("START_PROCESS".equals(text(action, "actionType"))) initialProcesses.add(text(action.path("detail"), "processKey"));
            }
        }
        for (var entry : phases.entrySet()) {
            List<Phase> members = entry.getValue();
            Aggregate owner = members.getFirst().rule();
            String processKey = entry.getKey();
            Aggregate process = context.stream().filter(a -> a.type() == SourceType.PROCESS && skill.equals(a.skillKey())
                && processKey.equals(a.key())).findFirst().orElse(null);
            if (process == null) {
                issues.add(located(issue(PATH + ".processKey", "UNKNOWN_PROCESS", "命中阶段过程不存在或不属于当前技能"), owner));
                continue;
            }
            if (!"ACTIVE".equals(text(process.data(), "activationType")) || initialProcesses.size() != 1 || !initialProcesses.contains(processKey))
                issues.add(located(issue(PATH + ".processKey", "PHASE_PROCESS_INVALID", "命中阶段必须引用本技能唯一真实首次主动过程"), owner));
            Map<String, Integer> order = new LinkedHashMap<>();
            Set<Integer> usedOrder = new HashSet<>();
            JsonNode steps = process.data().path("steps");
            boolean invalidSteps = !steps.isArray() || steps.isEmpty() || steps.size() > 64;
            boolean hasDelay = false;
            for (JsonNode step : steps) {
                String key = text(step, "stepKey");
                JsonNode sort = step.path("sortOrder");
                if (key == null || !sort.isIntegralNumber() || !sort.canConvertToInt() || order.containsKey(key)
                    || !usedOrder.add(sort.intValue()) || !("IMMEDIATE".equals(text(step, "stepType")) || "DELAY".equals(text(step, "stepType")))) invalidSteps = true;
                if (key != null && sort.isIntegralNumber() && sort.canConvertToInt()) order.put(key, sort.intValue());
                hasDelay |= "DELAY".equals(text(step, "stepType"));
            }
            invalidSteps |= steps.size() > 1 && !hasDelay;
            if (invalidSteps)
                issues.add(located(issue(PATH + ".processKey", "PHASE_STEP_SEQUENCE_INVALID", "分阶段命中要求1至64个排序明确的即时或有限延时步骤，多步过程至少包含一个延时步骤"), owner));
            Map<String, Phase> byStep = new LinkedHashMap<>();
            for (Phase phase : members) {
                Phase first = byStep.putIfAbsent(phase.step(), phase);
                if (first != null && !Objects.equals(first.prior(), phase.prior()))
                    issues.add(located(issue(PATH + ".requiresPriorStepKey", "PHASE_DEPENDENCY_CONFLICT", "同一步骤全部命中规则的前置依赖必须一致"), phase.rule()));
                if (!order.containsKey(phase.step()))
                    issues.add(located(issue(PATH + ".moment.stepKey", "UNKNOWN_STEP", "命中阶段步骤不存在或不属于当前过程"), phase.rule()));
            }
            if (byStep.size() > 64)
                issues.add(located(issue(PATH, "PHASE_LIMIT_EXCEEDED", "同一过程最多64个实际命中阶段"), owner));
            for (Phase phase : members) {
                if (phase.prior() == null) continue;
                Integer priorOrder = order.get(phase.prior());
                Integer currentOrder = order.get(phase.step());
                if (!byStep.containsKey(phase.prior()) || priorOrder == null || currentOrder == null || priorOrder >= currentOrder)
                    issues.add(located(issue(PATH + ".requiresPriorStepKey", "PHASE_DEPENDENCY_INVALID", "前置步骤必须是同过程严格更早且仍有实际命中规则的阶段"), phase.rule()));
            }
            for (Aggregate rule : rules) {
                JsonNode event = rule.data().path("eventSource");
                JsonNode detail = event.path("detail");
                String source = text(detail, "sourceSkillKey");
                if ("SKILL_HIT".equals(text(event, "eventType")) && !detail.has("processMoment")
                    && (source == null || skill.equals(source)))
                    issues.add(located(issue(PATH, "PHASE_MODE_MIXED", "同一真实过程不能混用隐式末尾命中与显式命中阶段"), rule));
            }
        }
        reject(issues);
    }

    private static List<Map<String, String>> rawShape(JsonNode phase) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (!phase.isObject()) {
            issues.add(issue(PATH, "VALUE_SHAPE_INVALID", "命中阶段必须为对象"));
            return issues;
        }
        phase.fieldNames().forEachRemaining(field -> { if (!PHASE_FIELDS.contains(field)) issues.add(issue(PATH + "." + field, "UNKNOWN_FIELD", "命中阶段包含未知字段")); });
        if (text(phase, "processKey") == null) issues.add(issue(PATH + ".processKey", "REQUIRED", "命中阶段必须指定过程"));
        JsonNode moment = phase.path("moment");
        if (!moment.isObject()) issues.add(issue(PATH + ".moment", "REQUIRED", "命中阶段必须指定步骤执行时点"));
        else {
            moment.fieldNames().forEachRemaining(field -> { if (!MOMENT_FIELDS.contains(field)) issues.add(issue(PATH + ".moment." + field, "UNKNOWN_FIELD", "命中阶段时点包含未知字段")); });
            if (!"STEP_EXECUTION".equals(text(moment, "momentType"))) issues.add(issue(PATH + ".moment.momentType", "REFERENCE_TYPE_MISMATCH", "命中阶段只允许步骤执行时点"));
            if (text(moment, "stepKey") == null) issues.add(issue(PATH + ".moment.stepKey", "REQUIRED", "命中阶段必须指定步骤"));
        }
        JsonNode prior = phase.get("requiresPriorStepKey");
        if (prior == null) issues.add(issue(PATH + ".requiresPriorStepKey", "REQUIRED", "必须明确前置命中步骤或空值"));
        else if (!prior.isNull() && text(phase, "requiresPriorStepKey") == null)
            issues.add(issue(PATH + ".requiresPriorStepKey", "VALUE_SHAPE_INVALID", "前置命中步骤必须为空值或非空步骤标识"));
        return issues;
    }

    private static void reject(List<Map<String, String>> issues) {
        if (!issues.isEmpty()) throw new ApiException(HttpStatus.CONFLICT, "409.SKILL_HIT_PHASE_INVALID", "实际命中阶段的最终配置不合法", Map.of("fieldIssues", List.copyOf(issues)));
    }

    private static Map<String, String> located(Map<String, String> issue, Aggregate source) {
        Map<String, String> row = new LinkedHashMap<>(issue);
        row.put("sourceSkillKey", source.skillKey()); row.put("sourceType", source.type().name()); row.put("sourceKey", source.key());
        return row;
    }

    private static Map<String, String> issue(String field, String code, String message) { return Map.of("field", field, "code", code, "message", message); }
    private static String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value == null || !value.isTextual() || value.asText().isBlank() ? null : value.asText().trim();
    }
    private record Phase(Aggregate rule, String process, String step, String prior) {}
}
