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

/** 即时伤害仅跟随同次命中另一结果的阻挡事实，不授予被引用技能执行资格。 */
public final class SkillSpellShieldFollowSemantics {
    private static final Pattern KEY = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");
    private static final Set<String> FIELDS = Set.of("skillKey", "effectKey", "resultKey");
    private static final Set<String> SCOPES = Set.of("SKILL", "EFFECT", "RESULT", "DAMAGE_INSTANCE");

    private SkillSpellShieldFollowSemantics() { }

    public static List<Map<String, String>> issues(SkillEffectLifecycleRequest lifecycle,
                                                  List<SkillEffectResultRequest> results) {
        return shape(AggregateJson.tree(AggregateJson.write(lifecycle)),
            AggregateJson.tree(AggregateJson.write(results)));
    }

    private static List<Map<String, String>> shape(JsonNode lifecycle, JsonNode results) {
        List<Map<String, String>> issues = new ArrayList<>();
        int index = 0;
        for (JsonNode result : results) {
            String path = "results[" + index++ + "].detail.spellShieldFollowResult";
            JsonNode detail = result.path("detail");
            if (!detail.has("spellShieldFollowResult")) continue;
            JsonNode reference = detail.path("spellShieldFollowResult");
            if (!reference.isObject() || reference.size() != FIELDS.size()) {
                issues.add(issue(path, "阻挡跟随须明确技能、效果与结果，不能为null或带额外字段"));
                continue;
            }
            reference.fieldNames().forEachRemaining(field -> {
                if (!FIELDS.contains(field)) issues.add(issue(path + "." + field, "未知阻挡跟随字段"));
            });
            for (String field : FIELDS) {
                JsonNode key = reference.path(field);
                if (!key.isTextual() || !KEY.matcher(key.textValue()).matches())
                    issues.add(issue(path + "." + field, "阻挡跟随标识必须是合法明确字符串"));
            }
            if (!immediateTargetDamage(lifecycle, result) || result.hasNonNull("spellShieldBlockScope")
                || detail.hasNonNull("attackDamageRole")) {
                issues.add(issue(path, "跟随仅用于无自身判盾范围、非普攻主体的即时目标伤害"));
            }
        }
        return List.copyOf(issues);
    }

    /** owners以实际角色关系提供；关闭或未学不移除定义关系，也不因此启用被引用来源。 */
    public static void validate(List<Aggregate> affected, List<Aggregate> context,
                                Map<String, Set<String>> owners) {
        Map<String, Aggregate> effects = new HashMap<>();
        for (Aggregate aggregate : context) if (aggregate.type() == SourceType.EFFECT)
            effects.put(aggregate.skillKey() + "/" + aggregate.key(), aggregate);
        for (Aggregate source : affected) {
            if (source.type() != SourceType.EFFECT) continue;
            List<Map<String, String>> issues = shape(source.data().path("lifecycle"), source.data().path("results"));
            if (!issues.isEmpty()) throw invalid(source, issues.getFirst());
            int index = 0;
            for (JsonNode result : source.data().path("results")) {
                String path = "results[" + index++ + "].detail.spellShieldFollowResult";
                JsonNode reference = result.path("detail").get("spellShieldFollowResult");
                if (reference == null) continue;
                String skill = text(reference, "skillKey"), effectKey = text(reference, "effectKey");
                String resultKey = text(reference, "resultKey");
                Aggregate effect = effects.get(skill + "/" + effectKey);
                if (source.skillKey().equals(skill) && source.key().equals(effectKey)
                    && resultKey.equals(text(result, "resultKey")))
                    throw invalid(source, issue(path, "阻挡结果不能跟随自身"));
                Set<String> sourceOwners = owners.getOrDefault(source.skillKey(), Set.of());
                if (sourceOwners.isEmpty() || !owners.getOrDefault(skill, Set.of()).containsAll(sourceOwners))
                    throw invalid(source, issue(path, "阻挡跟随只能引用同一实际角色关系中的技能"));
                JsonNode producer = null;
                int matches = 0;
                if (effect != null) for (JsonNode candidate : effect.data().path("results")) {
                    if (resultKey.equals(text(candidate, "resultKey"))) { producer = candidate; matches++; }
                }
                if (matches != 1 || producer == null || !immediateTargetDamage(effect.data().path("lifecycle"), producer)
                    || !SCOPES.contains(text(producer, "spellShieldBlockScope"))
                    || producer.path("detail").hasNonNull("attackDamageRole")
                    || producer.path("detail").has("spellShieldFollowResult"))
                    throw invalid(source, issue(path, "所指结果须为唯一可判盾即时目标伤害，不能是跟随链、环或普攻主体"));
            }
        }
    }

    private static boolean immediateTargetDamage(JsonNode lifecycle, JsonNode result) {
        JsonNode behavior = result.path("lifecycleBehavior");
        return (lifecycle.isNull() || lifecycle.isMissingNode()) && "DAMAGE".equals(text(result, "resultType"))
            && "TARGET".equals(text(result, "target"))
            && (behavior.isNull() || behavior.isMissingNode());
    }

    private static String text(JsonNode node, String field) { return node.path(field).asText(""); }
    private static Map<String, String> issue(String field, String message) {
        return Map.of("field", field, "code", "INVALID_SPELL_SHIELD_FOLLOW", "message", message);
    }
    private static ApiException invalid(Aggregate source, Map<String, String> issue) {
        Map<String, String> located = new HashMap<>(issue);
        located.put("sourceSkillKey", source.skillKey()); located.put("sourceType", source.type().name());
        located.put("sourceKey", source.key());
        return new ApiException(HttpStatus.CONFLICT, "409.SKILL_OBJECT_REFERENCE_INVALID", "同次命中阻挡跟随不合法",
            Map.of("fieldIssues", List.of(Map.copyOf(located))));
    }
}
