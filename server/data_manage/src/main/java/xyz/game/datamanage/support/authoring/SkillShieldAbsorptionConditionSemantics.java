package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

/** 本笔受伤条件读取同技能自身明确普通盾的吸收量；省略选择器仍是原总吸收量。 */
public final class SkillShieldAbsorptionConditionSemantics {
    private static final Set<String> FIELDS = Set.of("skillKey", "effectKey", "resultKey");
    private static final Pattern KEY = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");

    private SkillShieldAbsorptionConditionSemantics() { }

    public static List<Map<String, String>> shapeIssues(String eventType, String eventValueKey,
                                                       JsonNode selector, String path) {
        if (selector == null) return List.of();
        List<Map<String, String>> issues = new ArrayList<>();
        if (!"DAMAGE_TAKEN".equals(eventType) || !"SHIELD_ABSORBED".equals(eventValueKey))
            issues.add(issue(path, "EVENT_VALUE_NOT_AVAILABLE", "指定护盾吸收量只允许受到伤害事件的护盾吸收值"));
        if (!selector.isObject() || selector.size() != 3) {
            issues.add(issue(path, "INVALID_SHIELD_RESULT", "护盾结果须明确技能、效果和结果，不能为null或夹带字段"));
            return List.copyOf(issues);
        }
        selector.fieldNames().forEachRemaining(field -> {
            if (!FIELDS.contains(field)) issues.add(issue(path + "." + field, "UNKNOWN_FIELD", "未知护盾结果字段"));
        });
        for (String field : FIELDS) {
            JsonNode value = selector.path(field);
            if (!value.isTextual() || !KEY.matcher(value.textValue()).matches())
                issues.add(issue(path + "." + field, "INVALID_REFERENCE", "护盾结果标识必须是明确合法字符串"));
        }
        return List.copyOf(issues);
    }

    /** 选择目标也须参加既有全等级数值检查，不能仅在盾本次被改写时证明单层。 */
    public static List<Aggregate> validate(List<Aggregate> affected, List<Aggregate> context) {
        Map<String, Aggregate> effects = new HashMap<>();
        for (Aggregate aggregate : context) if (aggregate.type() == SourceType.EFFECT)
            effects.put(aggregate.skillKey() + "/" + aggregate.key(), aggregate);
        Set<Aggregate> selected = new LinkedHashSet<>();
        for (Aggregate source : affected) {
            if (source.type() != SourceType.TRIGGER) continue;
            int groupIndex = 0;
            for (JsonNode group : source.data().path("conditionGroups")) {
                int conditionIndex = 0;
                for (JsonNode condition : group.path("conditions")) {
                    String path = "conditionGroups[" + groupIndex + "].conditions[" + conditionIndex++ + "].detail.shieldResult";
                    JsonNode detail = condition.path("detail");
                    if (!detail.has("shieldResult")) continue;
                    JsonNode selector = detail.get("shieldResult");
                    List<Map<String, String>> issues = shapeIssues(
                        source.data().path("eventSource").path("eventType").textValue(),
                        detail.path("eventValueKey").textValue(), selector, path);
                    if (!"EVENT_VALUE_COMPARE".equals(condition.path("conditionType").textValue()))
                        throw invalid(source, issue(path, "INVALID_SHIELD_RESULT", "只有事件值比较条件可以指定护盾结果"));
                    if (!issues.isEmpty()) throw invalid(source, issues.getFirst());
                    if (!source.skillKey().equals(selector.path("skillKey").textValue()))
                        throw invalid(source, issue(path + ".skillKey", "REFERENCE_TYPE_MISMATCH", "只能读取当前技能自身的普通盾"));
                    Aggregate target = effects.get(source.skillKey() + "/" + selector.path("effectKey").textValue());
                    if (target == null) throw invalid(source, issue(path + ".effectKey", "UNKNOWN_EFFECT", "指定护盾效果不存在"));
                    JsonNode life = target.data().path("lifecycle"), shield = null;
                    String resultKey = selector.path("resultKey").textValue();
                    int matches = 0, normalShields = 0;
                    for (JsonNode result : target.data().path("results")) {
                        if (resultKey.equals(result.path("resultKey").textValue())) { shield = result; matches++; }
                        if ("NORMAL_SHIELD".equals(result.path("resultType").textValue())) normalShields++;
                    }
                    if (matches != 1 || normalShields != 1 || shield == null
                        || !"NORMAL_SHIELD".equals(shield.path("resultType").textValue())
                        || !"SOURCE".equals(shield.path("target").textValue())
                        || !"SOURCE".equals(life.path("instanceScope").textValue())
                        || !resultKey.equals(life.path("endWhenShieldEndsResultKey").textValue()))
                        throw invalid(source, issue(path + ".resultKey", "REFERENCE_TYPE_MISMATCH", "指定结果须为本技能自身唯一、随盾结束的持续普通盾"));
                    ShieldEndLifecycleSemantics.validate(List.of(target));
                    selected.add(target);
                }
                groupIndex++;
            }
        }
        return List.copyOf(selected);
    }

    private static Map<String, String> issue(String field, String code, String message) {
        return Map.of("field", field, "code", code, "message", message);
    }

    private static ApiException invalid(Aggregate source, Map<String, String> issue) {
        Map<String, String> located = new LinkedHashMap<>(issue);
        located.put("sourceSkillKey", source.skillKey());
        located.put("sourceType", source.type().name());
        located.put("sourceKey", source.key());
        return new ApiException(HttpStatus.CONFLICT, "409.SKILL_OBJECT_REFERENCE_INVALID",
            "指定自身护盾吸收量的条件与最终配置不匹配", Map.of("fieldIssues", List.of(Map.copyOf(located))));
    }
}
