package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultRequest;

/** 最终属性上界的单一形状约束；保存与最终聚合预检复用，数值静态性归数值校验。 */
public final class AttributeFinalLimitSemantics {
    private AttributeFinalLimitSemantics() { }

    public static void validateEffectShape(SkillEffectLifecycleRequest lifecycle,
                                          List<SkillEffectResultRequest> results,
                                          List<Map<String, String>> issues) {
        JsonNode life = AggregateJson.tree(AggregateJson.write(lifecycle));
        JsonNode rows = AggregateJson.tree(AggregateJson.write(results));
        for (int i = 0; i < rows.size(); i++) issues.addAll(issues(life, rows.get(i), "results[" + i + "]"));
    }

    public static List<Map<String, String>> issues(JsonNode life, JsonNode result, String path) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (!"ATTRIBUTE_CHANGE".equals(result.path("resultType").asText())
            || !"LIMIT_MAX".equals(result.path("detail").path("operation").asText())) return issues;
        JsonNode detail = result.path("detail"), behavior = result.path("lifecycleBehavior");
        if (!"SOURCE".equals(result.path("target").asText()) || "hp".equals(detail.path("attributeKey").asText())
            || detail.hasNonNull("modifierZoneKey") || detail.has("requiredShield") || result.hasNonNull("spellShieldBlockScope")) {
            add(issues, path + ".detail", "最终上界只接受自身非生命普通属性，乘区与护盾关联必须为空");
        }
        if (!life.isObject() || !life.hasNonNull("durationValue")
            || !"SOURCE".equals(life.path("instanceScope").asText())
            || !"KEEP".equals(life.path("reapplicationStackMode").asText())
            || !"REFRESH_ALL".equals(life.path("reapplicationDurationMode").asText())
            || !"ALL_AT_ONCE".equals(life.path("expiryMode").asText())
            || life.hasNonNull("periodicIntervalValue") || life.hasNonNull("firstPeriodicExecution")
            || life.hasNonNull("endWhenShieldEndsResultKey")) add(issues, "lifecycle", "最终上界需要有限自身单层、刷新全部且无周期的生命周期");
        boolean snapshot = "APPLICATION_SNAPSHOT".equals(behavior.path("valueReadMode").asText());
        boolean current = "MOMENT_EVALUATION".equals(behavior.path("valueReadMode").asText());
        if (!"PERSISTENT".equals(behavior.path("moment").asText()) || !"SHARED".equals(behavior.path("stackValueMode").asText())
            || (!snapshot && !current) || (snapshot ? !"REPLACE".equals(behavior.path("reapplicationValueMode").asText())
                : behavior.hasNonNull("reapplicationValueMode")) || behavior.hasNonNull("periodicExecutionMode")) {
            add(issues, path + ".lifecycleBehavior", "最终上界必须持续生效并共用静态上界值，不能作为即时覆盖");
        }
        if (!result.path("valueRule").isObject()) add(issues, path + ".valueRule", "最终上界必须明确静态有限数值");
        return issues;
    }

    private static void add(List<Map<String, String>> issues, String field, String message) {
        issues.add(Map.of("field", field, "code", "ATTRIBUTE_FINAL_LIMIT_INVALID", "message", message));
    }
}
