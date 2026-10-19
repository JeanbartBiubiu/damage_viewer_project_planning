package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultRequest;

/** 同一形状检查同时用于效果保存和事务最终数值复核；实际能力绑定由计算端证明。 */
public final class SkillCooldownDurationSemantics {
    private SkillCooldownDurationSemantics() { }

    public static void validateEffectShape(SkillEffectLifecycleRequest lifecycle,
                                          List<SkillEffectResultRequest> results,
                                          List<Map<String, String>> issues) {
        JsonNode life = AggregateJson.tree(AggregateJson.write(lifecycle));
        JsonNode rows = AggregateJson.tree(AggregateJson.write(results));
        for (int i = 0; i < rows.size(); i++) issues.addAll(issues(life, rows.get(i), "results[" + i + "]"));
    }

    public static List<Map<String, String>> issues(JsonNode life, JsonNode result, String path) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (!"COOLDOWN_DURATION_MODIFIER".equals(result.path("resultType").asText())) return issues;
        if (!"SOURCE".equals(result.path("target").asText())) add(issues, path + ".target", "只允许来源自身的冷却时长修正");
        if (result.hasNonNull("spellShieldBlockScope")) add(issues, path + ".spellShieldBlockScope", "自身冷却时长修正不能消费法术护盾");
        if (!life.isObject() || !life.hasNonNull("durationValue")
            || !"SOURCE".equals(life.path("instanceScope").asText())
            || !"KEEP".equals(life.path("reapplicationStackMode").asText())
            || !"REFRESH_ALL".equals(life.path("reapplicationDurationMode").asText())
            || !"ALL_AT_ONCE".equals(life.path("expiryMode").asText())
            || life.hasNonNull("periodicIntervalValue") || life.hasNonNull("firstPeriodicExecution")
            || life.hasNonNull("endWhenShieldEndsResultKey")) {
            add(issues, "lifecycle", "冷却时长修正要求有限自身单层、保持层数并刷新全部、同时到期且无周期或护盾关联");
        }
        JsonNode behavior = result.path("lifecycleBehavior");
        if (!behavior.isObject() || !"PERSISTENT".equals(behavior.path("moment").asText())
            || !"APPLICATION_SNAPSHOT".equals(behavior.path("valueReadMode").asText())
            || !"SHARED".equals(behavior.path("stackValueMode").asText())
            || !"REPLACE".equals(behavior.path("reapplicationValueMode").asText())
            || behavior.hasNonNull("periodicExecutionMode")) {
            add(issues, path + ".lifecycleBehavior", "冷却时长修正必须持续生效、静态施加快照、共享数值且重施覆盖");
        }
        JsonNode detail = result.path("detail"), scope = detail.path("affectedSkillScope");
        Set<String> keys = new HashSet<>();
        boolean valid = detail.isObject() && detail.size() == 1 && scope.isObject() && scope.size() == 3
            && "SKILLS".equals(scope.path("mode").asText())
            && scope.path("skillKeys").isArray() && !scope.path("skillKeys").isEmpty()
            && scope.path("skillCategoryKeys").isArray() && scope.path("skillCategoryKeys").isEmpty();
        for (JsonNode key : scope.path("skillKeys")) {
            valid &= key.isTextual() && key.textValue().matches("^[a-z][a-z0-9_]{0,63}$") && keys.add(key.textValue());
        }
        if (!valid) add(issues, path + ".detail.affectedSkillScope", "冷却时长修正只接受明确非空且无重复的指定技能范围");
        if (!result.path("valueRule").isObject()) add(issues, path + ".valueRule", "冷却时长修正必须提供静态正倍率");
        return issues;
    }

    private static void add(List<Map<String, String>> issues, String field, String message) {
        issues.add(Map.of("field", field, "code", "COOLDOWN_DURATION_MODIFIER_INVALID", "message", message));
    }
}
