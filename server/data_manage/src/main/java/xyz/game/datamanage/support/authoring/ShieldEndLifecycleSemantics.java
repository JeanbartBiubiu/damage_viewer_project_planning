package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleExpiryMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleInstanceScope;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleReapplicationStackMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleMoment;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleStackValueMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectNormalShieldDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultType;
import xyz.game.datamanage.model.skilleffect.SkillEffectTarget;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

/** 父生命周期与同父普通护盾的结构关联；数值恒一由 SkillNumericSemantics 检查。 */
public final class ShieldEndLifecycleSemantics {
    private static final Pattern KEY = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");
    private static final String FIELD = "lifecycle.endWhenShieldEndsResultKey";

    private ShieldEndLifecycleSemantics() { }

    public static List<Map<String, String>> issues(SkillEffectLifecycleRequest lifecycle,
                                                    List<SkillEffectResultRequest> results) {
        if (lifecycle == null || lifecycle.endWhenShieldEndsResultKey() == null) return List.of();
        List<Map<String, String>> issues = new ArrayList<>();
        String key = lifecycle.endWhenShieldEndsResultKey();
        if (!KEY.matcher(key).matches()) {
            issues.add(issue(FIELD, "INVALID_REFERENCE", "指定护盾结果标识不合法"));
            return issues;
        }
        Map<String, Integer> indexes = new HashMap<>();
        for (int i = 0; i < results.size(); i++) {
            SkillEffectResultRequest result = results.get(i);
            if (result != null && result.resultKey() != null) indexes.putIfAbsent(result.resultKey(), i);
        }
        Integer shieldIndex = indexes.get(key);
        if (shieldIndex == null) {
            issues.add(issue(FIELD, "UNKNOWN_RESULT", "指定护盾必须是同一效果内的结果"));
            return issues;
        }
        SkillEffectResultRequest shield = results.get(shieldIndex);
        if (shield.resultType() != SkillEffectResultType.NORMAL_SHIELD
            || !(shield.detail() instanceof SkillEffectNormalShieldDetail)
            || shield.valueRule() == null) {
            issues.add(issue(FIELD, "RESULT_TYPE_MISMATCH", "指定结果必须是有效的持续普通护盾"));
            return issues;
        }
        if (shield.lifecycleBehavior() == null
            || shield.lifecycleBehavior().moment() != SkillEffectLifecycleMoment.PERSISTENT) {
            issues.add(issue("results[" + shieldIndex + "].lifecycleBehavior.moment", "COMBINATION_INVALID",
                "指定护盾必须持续生效"));
        } else if (shield.lifecycleBehavior().stackValueMode() != SkillEffectLifecycleStackValueMode.SHARED) {
            issues.add(issue("results[" + shieldIndex + "].lifecycleBehavior.stackValueMode", "COMBINATION_INVALID",
                "指定护盾必须使用共享护盾值"));
        }
        if (lifecycle.reapplicationStackMode() != SkillEffectLifecycleReapplicationStackMode.KEEP) {
            issues.add(issue("lifecycle.reapplicationStackMode", "COMBINATION_INVALID", "关联护盾只支持重复施加时保留单层"));
        }
        if (lifecycle.expiryMode() != SkillEffectLifecycleExpiryMode.ALL_AT_ONCE
            && lifecycle.expiryMode() != SkillEffectLifecycleExpiryMode.EXPLICIT_ONLY) {
            issues.add(issue("lifecycle.expiryMode", "COMBINATION_INVALID", "关联护盾只支持整体到期或无期限显式结束"));
        }
        SkillEffectTarget expectedTarget = switch (lifecycle.instanceScope()) {
            case SOURCE -> SkillEffectTarget.SOURCE;
            case TARGET, SOURCE_TARGET -> SkillEffectTarget.TARGET;
            case SKILL -> null;
            case null -> null;
        };
        if (expectedTarget == null) {
            issues.add(issue("lifecycle.instanceScope", "COMBINATION_INVALID", "关联护盾需要明确承受者的实例范围"));
        } else if (shield.target() != expectedTarget) {
            issues.add(issue("results[" + shieldIndex + "].target", "COMBINATION_INVALID",
                "指定护盾目标与生命周期实例范围不一致"));
        }
        for (int i = 0; i < results.size(); i++) {
            SkillEffectResultRequest result = results.get(i);
            if (result != null && result.lifecycleBehavior() != null
                && result.lifecycleBehavior().moment() == SkillEffectLifecycleMoment.PERSISTENT
                && result.target() != shield.target()) {
                issues.add(issue("results[" + i + "].target", "COMBINATION_INVALID",
                    "同一效果的持续结果必须与指定护盾作用于同一对象"));
            }
        }
        return List.copyOf(issues);
    }

    /** 写事务提交前读取最终聚合，避免后续修改留下失效的结构关联。 */
    public static void validate(List<Aggregate> aggregates) {
        for (Aggregate aggregate : aggregates) {
            if (aggregate.type() != SourceType.EFFECT) continue;
            JsonNode lifecycle = aggregate.data().path("lifecycle");
            if (!lifecycle.isObject() || !lifecycle.hasNonNull("endWhenShieldEndsResultKey")) continue;
            SkillEffectLifecycleRequest parsedLifecycle = AggregateJson.read(lifecycle.toString(), SkillEffectLifecycleRequest.class);
            List<SkillEffectResultRequest> results = AggregateJson.readList(
                aggregate.data().path("results").toString(), SkillEffectResultRequest.class);
            List<Map<String, String>> issues = issues(parsedLifecycle, results);
            if (issues.isEmpty()) continue;
            List<Map<String, String>> located = new ArrayList<>();
            for (Map<String, String> issue : issues) {
                Map<String, String> fields = new LinkedHashMap<>(issue);
                fields.put("sourceSkillKey", aggregate.skillKey());
                fields.put("sourceType", aggregate.type().name());
                fields.put("sourceKey", aggregate.key());
                located.add(Map.copyOf(fields));
            }
            throw new ApiException(HttpStatus.CONFLICT, "409.SKILL_OBJECT_REFERENCE_INVALID",
                "随护盾结束的生命周期关联不合法", Map.of("fieldIssues", List.copyOf(located)));
        }
    }

    private static Map<String, String> issue(String field, String code, String message) {
        return Map.of("field", field, "code", code, "message", message);
    }
}
