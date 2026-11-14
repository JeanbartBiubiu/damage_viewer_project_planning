package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import xyz.game.datamanage.model.skilleffect.SkillEffectCreateRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultRequest;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

/** 累计总冷却返还额度的作者形状及同技能、同目标能力的上限一致性。 */
public final class CooldownCumulativeLimitSemantics {
    private static final Pattern KEY = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");
    private static final Set<String> FIELDS = Set.of("groupKey", "maxRatio");

    private CooldownCumulativeLimitSemantics() { }

    public static List<Map<String, String>> issues(List<SkillEffectResultRequest> results) {
        return shape(AggregateJson.tree(AggregateJson.write(results)));
    }

    /** 候选预检与聚合保存按完整最终效果集合核对，不读取或创建主动入口。 */
    public static void validateCandidates(String skillKey, Map<String, SkillEffectCreateRequest> effects) {
        List<Aggregate> aggregates = effects.entrySet().stream().map(entry -> new Aggregate(
            SourceType.EFFECT, skillKey, entry.getKey(), AggregateJson.tree(AggregateJson.write(entry.getValue())))).toList();
        validate(aggregates, aggregates);
    }

    /** 单效果写入也在原事务最终态中与其它同技能效果共用该检查。 */
    public static void validate(List<Aggregate> affected, List<Aggregate> context) {
        Set<String> skills = affected.stream().map(Aggregate::skillKey).collect(java.util.stream.Collectors.toSet());
        Map<LimitIdentity, BigDecimal> limits = new HashMap<>();
        for (Aggregate source : context) {
            if (source.type() != SourceType.EFFECT || !skills.contains(source.skillKey())) continue;
            JsonNode results = source.data().path("results");
            List<Map<String, String>> issues = shape(results);
            if (!issues.isEmpty()) throw invalid(source, issues.getFirst());
            int index = 0;
            for (JsonNode result : results) {
                String path = "results[" + index++ + "].detail.cumulativeLimit";
                JsonNode detail = result.path("detail"), limit = detail.get("cumulativeLimit");
                if (limit == null) continue;
                String targetSkill = detail.path("affectedSkillScope").path("skillKeys").get(0).textValue();
                LimitIdentity identity = new LimitIdentity(source.skillKey(), limit.path("groupKey").textValue(), targetSkill);
                BigDecimal ratio = limit.path("maxRatio").decimalValue();
                BigDecimal previous = limits.putIfAbsent(identity, ratio);
                if (previous != null && previous.compareTo(ratio) != 0) throw invalid(source,
                    issue(path + ".maxRatio", "CUMULATIVE_LIMIT_CONFLICT", "同技能、同共享组及同被返还技能的累计上限必须一致"));
            }
        }
    }

    private static List<Map<String, String>> shape(JsonNode results) {
        List<Map<String, String>> issues = new ArrayList<>();
        int index = 0;
        for (JsonNode result : results) {
            String path = "results[" + index++ + "].detail.cumulativeLimit";
            JsonNode detail = result.path("detail");
            if (!detail.has("cumulativeLimit")) continue;
            JsonNode limit = detail.path("cumulativeLimit");
            if (!"COOLDOWN_CHANGE".equals(result.path("resultType").asText())
                || !"REDUCE_TOTAL_RATIO".equals(detail.path("operation").asText())) {
                issues.add(issue(path, "INVALID_CUMULATIVE_LIMIT", "累计额度只用于普通总冷却比例返还"));
            }
            if (!limit.isObject()) {
                issues.add(issue(path, "INVALID_CUMULATIVE_LIMIT", "累计额度必须明确共享组和上限，不能为null或其它形状"));
                continue;
            }
            limit.fieldNames().forEachRemaining(field -> {
                if (!FIELDS.contains(field)) issues.add(issue(path + "." + field, "UNKNOWN_FIELD", "未知累计额度字段"));
            });
            JsonNode group = limit.path("groupKey"), ratio = limit.path("maxRatio");
            if (!group.isTextual() || !KEY.matcher(group.textValue()).matches())
                issues.add(issue(path + ".groupKey", "INVALID_CUMULATIVE_LIMIT", "共享组必须是明确合法标识"));
            if (!ratio.isNumber() || !Double.isFinite(ratio.doubleValue()) || ratio.doubleValue() <= 0 || ratio.decimalValue().signum() <= 0
                || ratio.decimalValue().compareTo(BigDecimal.ONE) > 0)
                issues.add(issue(path + ".maxRatio", "INVALID_CUMULATIVE_LIMIT", "累计比例上限必须是大于0且不超过1的有限数值"));
            JsonNode scope = detail.path("affectedSkillScope"), targets = scope.path("skillKeys"), categories = scope.path("skillCategoryKeys");
            if (!"SKILLS".equals(scope.path("mode").asText()) || !targets.isArray() || targets.size() != 1
                || !targets.get(0).isTextual() || !KEY.matcher(targets.get(0).textValue()).matches()
                || !categories.isArray() || !categories.isEmpty())
                issues.add(issue(path, "INVALID_CUMULATIVE_LIMIT", "累计额度须指定唯一明确被返还技能，不能使用全部或分类范围"));
        }
        return List.copyOf(issues);
    }

    private record LimitIdentity(String ownerSkillKey, String groupKey, String targetSkillKey) { }

    private static Map<String, String> issue(String field, String code, String message) {
        return Map.of("field", field, "code", code, "message", message);
    }

    private static ApiException invalid(Aggregate source, Map<String, String> issue) {
        Map<String, String> located = new HashMap<>(issue);
        located.put("sourceSkillKey", source.skillKey());
        located.put("sourceType", source.type().name());
        located.put("sourceKey", source.key());
        return new ApiException(HttpStatus.CONFLICT, "409.SKILL_OBJECT_REFERENCE_INVALID", "累计冷却返还额度不合法",
            Map.of("fieldIssues", List.of(Map.copyOf(located))));
    }
}
