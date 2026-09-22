package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerOncePerUse;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerOncePerUseScope;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

/**
 * 同次使用限制的形状、事件资格与同技能组范围一致性。
 * 管理保存与最终聚合检查共用此语义，不按装备名或技能名分支。
 */
public final class SkillTriggerOncePerUseSemantics {
    public static final Pattern GROUP_KEY = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");
    public static final Set<SkillTriggerEventType> ALLOWED_EVENTS = Set.of(
        SkillTriggerEventType.SKILL_HIT,
        SkillTriggerEventType.BASIC_ATTACK_HIT,
        SkillTriggerEventType.BASIC_ATTACK_START
    );

    private SkillTriggerOncePerUseSemantics() {
    }

    public record Enabled(String groupKey, String scope, Set<String> unknownFields) {
        public Enabled {
            unknownFields = unknownFields == null ? Set.of() : Set.copyOf(unknownFields);
        }
    }

    public record Parsed(Enabled enabled, boolean present, boolean shapeInvalid) {
        public static Parsed absent() {
            return new Parsed(null, false, false);
        }

        public static Parsed notObject() {
            return new Parsed(null, true, true);
        }

        public static Parsed of(Enabled enabled) {
            return new Parsed(enabled, true, false);
        }
    }

    public record Member(String ruleKey, String groupKey, String scope) {
    }

    public static Member member(String ruleKey, Parsed parsed) {
        if (parsed == null || parsed.enabled() == null) {
            return null;
        }
        String groupKey = parsed.enabled().groupKey();
        String scope = parsed.enabled().scope();
        if (groupKey == null || !GROUP_KEY.matcher(groupKey).matches() || !isScope(scope)) {
            return null;
        }
        return new Member(ruleKey, groupKey, scope);
    }

    public static Parsed fromDto(SkillTriggerOncePerUse value) {
        if (value == null) {
            return Parsed.absent();
        }
        return Parsed.of(new Enabled(
            value.groupKey(),
            value.scope() == null ? null : value.scope().name(),
            value.unknownFields()
        ));
    }

    public static Parsed parse(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) {
            return Parsed.absent();
        }
        if (!node.isObject()) {
            return Parsed.notObject();
        }
        Set<String> unknown = new LinkedHashSet<>();
        node.fieldNames().forEachRemaining(name -> {
            if (!"groupKey".equals(name) && !"scope".equals(name)) {
                unknown.add(name);
            }
        });
        return Parsed.of(new Enabled(optionalText(node.get("groupKey")), optionalText(node.get("scope")), unknown));
    }

    public static List<Map<String, String>> unknownFieldIssues(Parsed parsed, String path) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (parsed.enabled() == null) {
            return issues;
        }
        for (String field : parsed.enabled().unknownFields()) {
            issues.add(issue(path + "." + field, "UNKNOWN_FIELD", "同次使用限制包含未知字段"));
        }
        return issues;
    }

    public static List<Map<String, String>> shapeIssues(Parsed parsed, String path) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (!parsed.present()) {
            return issues;
        }
        if (parsed.shapeInvalid()) {
            issues.add(issue(path, "VALUE_SHAPE_INVALID", "同次使用限制必须是对象"));
            return issues;
        }
        Enabled enabled = parsed.enabled();
        if (enabled.groupKey() == null) {
            issues.add(issue(path + ".groupKey", "REQUIRED", "共享限制键不能为空"));
        } else if (!GROUP_KEY.matcher(enabled.groupKey()).matches()) {
            issues.add(issue(path + ".groupKey", "KEY_FORMAT_INVALID", "共享限制键格式不合法"));
        }
        if (enabled.scope() == null) {
            issues.add(issue(path + ".scope", "REQUIRED", "同次使用限制范围不能为空"));
        } else if (!isScope(enabled.scope())) {
            issues.add(issue(path + ".scope", "VALUE_SHAPE_INVALID", "同次使用限制范围不合法"));
        }
        return issues;
    }

    public static List<Map<String, String>> eventIssues(SkillTriggerEventType eventType, Parsed parsed, String path) {
        if (!parsed.present() || parsed.shapeInvalid()) {
            return List.of();
        }
        if (eventType != null && ALLOWED_EVENTS.contains(eventType)) {
            return List.of();
        }
        return List.of(issue(path, "ONCE_PER_USE_EVENT_INVALID", "同次使用限制只允许用于技能命中、普通攻击命中或普通攻击开始"));
    }

    public static List<Map<String, String>> groupIssues(
        String currentRuleKey,
        Parsed current,
        List<Member> others,
        String path
    ) {
        if (!current.present() || current.shapeInvalid() || current.enabled() == null) {
            return List.of();
        }
        String groupKey = current.enabled().groupKey();
        String scope = current.enabled().scope();
        if (groupKey == null || !GROUP_KEY.matcher(groupKey).matches() || !isScope(scope)) {
            return List.of();
        }
        for (Member other : others) {
            if (other == null || other.ruleKey() == null || other.ruleKey().equals(currentRuleKey)) {
                continue;
            }
            if (!groupKey.equals(other.groupKey()) || !isScope(other.scope())) {
                continue;
            }
            if (!scope.equals(other.scope())) {
                Map<String, String> issue = new LinkedHashMap<>();
                issue.put("field", path + ".scope");
                issue.put("code", "ONCE_PER_USE_SCOPE_CONFLICT");
                issue.put("message", "同技能同一共享限制键的范围必须一致");
                issue.put("conflictingRuleKey", other.ruleKey());
                return List.of(issue);
            }
        }
        return List.of();
    }

    public static List<Map<String, String>> groupConsistencyIssues(List<Member> members, String path) {
        Map<String, Member> firstByGroup = new LinkedHashMap<>();
        List<Map<String, String>> issues = new ArrayList<>();
        for (Member member : members) {
            if (member == null || member.groupKey() == null || !GROUP_KEY.matcher(member.groupKey()).matches()
                || !isScope(member.scope())) {
                continue;
            }
            Member first = firstByGroup.putIfAbsent(member.groupKey(), member);
            if (first != null && !first.scope().equals(member.scope())) {
                Map<String, String> issue = new LinkedHashMap<>();
                issue.put("field", path + ".scope");
                issue.put("code", "ONCE_PER_USE_SCOPE_CONFLICT");
                issue.put("message", "同技能同一共享限制键的范围必须一致");
                issue.put("conflictingRuleKey", first.ruleKey());
                issue.put("sourceKey", member.ruleKey());
                issues.add(issue);
            }
        }
        return issues;
    }

    public static void validate(List<Aggregate> aggregates) {
        List<Map<String, String>> issues = new ArrayList<>();
        Map<String, List<Member>> membersBySkill = new LinkedHashMap<>();
        for (Aggregate aggregate : aggregates) {
            if (aggregate.type() != SourceType.TRIGGER) {
                continue;
            }
            Parsed parsed = parse(aggregate.data().path("limits").path("oncePerUse"));
            SkillTriggerEventType eventType = eventType(aggregate.data().path("eventSource").path("eventType"));
            List<Map<String, String>> local = new ArrayList<>();
            local.addAll(unknownFieldIssues(parsed, "limits.oncePerUse"));
            local.addAll(shapeIssues(parsed, "limits.oncePerUse"));
            local.addAll(eventIssues(eventType, parsed, "limits.oncePerUse"));
            for (Map<String, String> issue : local) {
                issues.add(located(issue, aggregate));
            }
            Member member = member(aggregate.key(), parsed);
            if (member != null) {
                membersBySkill.computeIfAbsent(aggregate.skillKey(), ignored -> new ArrayList<>()).add(member);
            }
        }
        for (Map.Entry<String, List<Member>> entry : membersBySkill.entrySet()) {
            for (Map<String, String> issue : groupConsistencyIssues(entry.getValue(), "limits.oncePerUse")) {
                Map<String, String> row = new LinkedHashMap<>(issue);
                String sourceKey = row.remove("sourceKey");
                row.put("sourceSkillKey", entry.getKey());
                row.put("sourceType", SourceType.TRIGGER.name());
                row.put("sourceKey", sourceKey);
                issues.add(row);
            }
        }
        if (!issues.isEmpty()) {
            throw new ApiException(
                HttpStatus.CONFLICT,
                "409.SKILL_TRIGGER_RULE_ONCE_PER_USE_INVALID",
                "同次使用限制的最终配置不合法",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
    }

    private static Map<String, String> located(Map<String, String> issue, Aggregate aggregate) {
        Map<String, String> row = new LinkedHashMap<>(issue);
        row.put("sourceSkillKey", aggregate.skillKey());
        row.put("sourceType", aggregate.type().name());
        row.put("sourceKey", aggregate.key());
        return row;
    }

    private static Map<String, String> issue(String field, String code, String message) {
        Map<String, String> issue = new LinkedHashMap<>();
        issue.put("field", field);
        issue.put("code", code);
        issue.put("message", message);
        return issue;
    }

    private static boolean isScope(String scope) {
        if (scope == null) {
            return false;
        }
        try {
            SkillTriggerOncePerUseScope.valueOf(scope);
            return true;
        } catch (IllegalArgumentException ex) {
            return false;
        }
    }

    private static SkillTriggerEventType eventType(JsonNode node) {
        String text = optionalText(node);
        if (text == null) {
            return null;
        }
        try {
            return SkillTriggerEventType.valueOf(text);
        } catch (IllegalArgumentException ex) {
            return null;
        }
    }

    private static String optionalText(JsonNode node) {
        if (node == null || node.isNull() || node.isMissingNode() || !node.isTextual()) {
            return null;
        }
        String trimmed = node.asText().trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
