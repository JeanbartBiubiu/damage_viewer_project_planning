package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultRequest;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

/** 静态自身属性对明确普通盾的持续依赖，不是某次事件的条件判断。 */
public final class ShieldAttributeDependencySemantics {
    private static final Pattern KEY = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");
    private static final Set<String> FIELDS = Set.of("skillKey", "effectKey", "resultKey");
    private ShieldAttributeDependencySemantics() { }

    public static List<Map<String, String>> issues(SkillEffectLifecycleRequest lifecycle,
                                                   List<SkillEffectResultRequest> results) {
        return shape(AggregateJson.tree(AggregateJson.write(lifecycle)),
            AggregateJson.tree(AggregateJson.write(results)));
    }

    private static List<Map<String, String>> shape(JsonNode life, JsonNode results) {
        List<Map<String, String>> issues = new ArrayList<>();
        int index = 0;
        for (JsonNode result : results) {
            String path = "results[" + index++ + "].detail.requiredShield";
            JsonNode detail = result.path("detail");
            if (!detail.has("requiredShield")) continue;
            JsonNode dependency = detail.path("requiredShield");
            if (!dependency.isObject() || dependency.size() != 3) {
                issues.add(issue(path, "INVALID_SHIELD_DEPENDENCY", "护盾依赖须明确技能、效果和结果，不能为null或带额外字段"));
                continue;
            }
            dependency.fieldNames().forEachRemaining(field -> {
                if (!FIELDS.contains(field)) issues.add(issue(path + "." + field, "UNKNOWN_FIELD", "未知护盾依赖字段"));
            });
            for (String field : FIELDS) {
                JsonNode value = dependency.path(field);
                if (!value.isTextual() || !KEY.matcher(value.textValue()).matches())
                    issues.add(issue(path + "." + field, "INVALID_REFERENCE", "护盾依赖标识必须是明确合法字符串"));
            }
            JsonNode behavior = result.path("lifecycleBehavior");
            boolean valid = results.size() == 1 && "ATTRIBUTE_CHANGE".equals(text(result, "resultType"))
                && "SOURCE".equals(text(result, "target")) && !"hp".equals(text(detail, "attributeKey"))
                && Set.of("INCREASE", "DECREASE").contains(text(detail, "operation"))
                && "PERSISTENT".equals(text(behavior, "moment"))
                && "MOMENT_EVALUATION".equals(text(behavior, "valueReadMode"))
                && "SHARED".equals(text(behavior, "stackValueMode"))
                && !behavior.hasNonNull("reapplicationValueMode") && !behavior.hasNonNull("periodicExecutionMode")
                && !result.hasNonNull("spellShieldBlockScope")
                && "SOURCE".equals(text(life, "instanceScope"))
                && "EXPLICIT_ONLY".equals(text(life, "expiryMode"))
                && "KEEP".equals(text(life, "reapplicationStackMode"))
                && !life.hasNonNull("durationValue") && !life.hasNonNull("reapplicationDurationMode")
                && !life.hasNonNull("periodicIntervalValue") && !life.hasNonNull("firstPeriodicExecution")
                && !life.hasNonNull("endWhenShieldEndsResultKey");
            if (!valid) issues.add(issue(path, "INVALID_SHIELD_DEPENDENCY", "护盾依赖只用于自身单结果、无期限、共享静态非生命属性"));
        }
        return List.copyOf(issues);
    }

    public static void validate(List<Aggregate> affected, List<Aggregate> context) {
        Map<String, Aggregate> effects = new HashMap<>();
        for (Aggregate aggregate : context) if (aggregate.type() == SourceType.EFFECT)
            effects.put(aggregate.skillKey() + "/" + aggregate.key(), aggregate);
        for (Aggregate source : affected) {
            if (source.type() != SourceType.EFFECT) continue;
            List<Map<String, String>> issues = shape(source.data().path("lifecycle"), source.data().path("results"));
            if (!issues.isEmpty()) throw invalid(source, issues.getFirst());
            int index = 0;
            for (JsonNode result : source.data().path("results")) {
                String path = "results[" + index++ + "].detail.requiredShield";
                JsonNode dependency = result.path("detail").get("requiredShield");
                if (dependency == null) continue;
                Aggregate target = effects.get(text(dependency, "skillKey") + "/" + text(dependency, "effectKey"));
                if (target == null || target == source || target.skillKey().equals(source.skillKey()) && target.key().equals(source.key()))
                    throw invalid(source, issue(path, "INVALID_SHIELD_DEPENDENCY", "护盾依赖须指向另一完整效果，不能循环引用自身"));
                JsonNode life = target.data().path("lifecycle");
                String shieldKey = text(dependency, "resultKey");
                JsonNode shield = null;
                int count = 0;
                int shieldCount = 0;
                for (JsonNode candidate : target.data().path("results")) {
                    if (shieldKey.equals(text(candidate, "resultKey"))) { shield = candidate; count++; }
                    if ("NORMAL_SHIELD".equals(text(candidate, "resultType"))) shieldCount++;
                    if (candidate.path("detail").has("requiredShield"))
                        throw invalid(source, issue(path, "INVALID_SHIELD_DEPENDENCY", "被引用护盾不能再依赖其它护盾"));
                }
                if (!"SOURCE".equals(text(life, "instanceScope")) || !shieldKey.equals(text(life, "endWhenShieldEndsResultKey"))
                    || count != 1 || shieldCount != 1 || shield == null || !"NORMAL_SHIELD".equals(text(shield, "resultType"))
                    || !"SOURCE".equals(text(shield, "target"))
                    || !"PERSISTENT".equals(text(shield.path("lifecycleBehavior"), "moment")))
                    throw invalid(source, issue(path, "INVALID_SHIELD_DEPENDENCY", "护盾依赖须指向来源自身的明确持续关联普通盾"));
                ShieldEndLifecycleSemantics.validate(List.of(target));
            }
        }
    }

    private static String text(JsonNode value, String field) { return value.path(field).asText(""); }
    private static Map<String, String> issue(String field, String code, String message) {
        return Map.of("field", field, "code", code, "message", message);
    }
    private static ApiException invalid(Aggregate source, Map<String, String> issue) {
        Map<String, String> located = new HashMap<>(issue);
        located.put("sourceSkillKey", source.skillKey()); located.put("sourceType", source.type().name());
        located.put("sourceKey", source.key());
        return new ApiException(HttpStatus.CONFLICT, "409.SKILL_OBJECT_REFERENCE_INVALID",
            "持续属性的护盾依赖不合法", Map.of("fieldIssues", List.of(Map.copyOf(located))));
    }
}
