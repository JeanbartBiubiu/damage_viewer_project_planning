package xyz.game.datamanage.service.skilltrigger.validation;

import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerAction;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventCapabilities;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSubject;
import xyz.game.datamanage.model.value.SkillNumericValue;
import xyz.game.datamanage.support.error.ApiException;

/** 触发规则的问题字段与路径；不读取或保存业务数据。 */
public final class SkillTriggerValidationSupport {

    private SkillTriggerValidationSupport() {}

    public static final Comparator<SkillTriggerAction> ACTION_ORDER = Comparator
        .comparing(SkillTriggerAction::sortOrder).thenComparing(SkillTriggerAction::actionKey);

    public static void rejectUnavailableEventSource(
        SkillTriggerEventType eventType,
        SkillTriggerSubject subject,
        String field,
        List<Map<String, String>> issues
    ) {
        if (subject == SkillTriggerSubject.EVENT_SOURCE && !SkillTriggerEventCapabilities.hasEventSource(eventType)) {
            issues.add(fieldIssue(field, "EVENT_SOURCE_NOT_AVAILABLE", "当前事件不提供事件来源对象"));
        }
    }

    public static Map<String, String> fieldIssue(String field, String code, String message) {
        Map<String, String> issue = new LinkedHashMap<>();
        issue.put("field", field);
        issue.put("code", code);
        issue.put("message", message);
        return issue;
    }

    public static Map<String, String> fieldIssue(String field, String code, String message, String rejectedValue) {
        Map<String, String> issue = fieldIssue(field, code, message);
        if (rejectedValue != null) {
            issue.put("rejectedValue", rejectedValue);
        }
        return issue;
    }

    public static String groupPath(int index, String suffix) {
        return suffix == null || suffix.isEmpty()
            ? "conditionGroups[" + index + "]"
            : "conditionGroups[" + index + "]." + suffix;
    }

    public static String conditionPath(int groupIndex, int conditionIndex, String suffix) {
        String base = "conditionGroups[" + groupIndex + "].conditions[" + conditionIndex + "]";
        return suffix == null || suffix.isEmpty() ? base : base + "." + suffix;
    }

    public static String actionPath(int index, String suffix) {
        return suffix == null || suffix.isEmpty() ? "actions[" + index + "]" : "actions[" + index + "]." + suffix;
    }

    public static String bindingPath(int actionIndex, int bindingIndex, String suffix) {
        String base = "actions[" + actionIndex + "].runtimeInputBindings[" + bindingIndex + "]";
        return suffix == null || suffix.isEmpty() ? base : base + "." + suffix;
    }

    public static String bindingPathFromPrefix(String actionPrefix, int bindingIndex, String suffix) {
        String base = actionPrefix + ".runtimeInputBindings[" + bindingIndex + "]";
        return suffix == null || suffix.isEmpty() ? base : base + "." + suffix;
    }

    public static String modifierPath(int actionIndex, int modifierIndex, String suffix) {
        String base = "actions[" + actionIndex + "].resultModifiers[" + modifierIndex + "]";
        return suffix == null || suffix.isEmpty() ? base : base + "." + suffix;
    }

    public static String resultPath(int index, String suffix) {
        return suffix == null || suffix.isEmpty() ? "results[" + index + "]" : "results[" + index + "]." + suffix;
    }

    public static <T> List<T> nullToEmpty(List<T> values) {
        return values == null ? List.of() : values;
    }

    public static Set<String> nullToEmptySet(Set<String> values) {
        return values == null ? Set.of() : values;
    }

    public static void throwIfInvalid(List<Map<String, String>> issues) {
        if (!issues.isEmpty()) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.VALIDATION_FAILED",
                "技能触发规则不合法",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
    }

    public static void require(SkillNumericValue value, String path, String message, List<Map<String, String>> issues) {
        if (value == null) issues.add(fieldIssue(path, "REQUIRED", message));
    }

    public static void require(Object value, String field, String message, List<Map<String, String>> issues) {
        if (value == null || (value instanceof String text && text.isBlank())) {
            issues.add(fieldIssue(field, "REQUIRED", message));
        }
    }
}
