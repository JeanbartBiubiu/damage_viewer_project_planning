package xyz.game.datamanage.service.simulation;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/** 只证明本场无法触发的完整自身750毫秒维护，不授权通用受击减冷却运行。 */
final class ReceivedCooldownMaintenanceSnapshotRules {
    private ReceivedCooldownMaintenanceSnapshotRules() { }

    static Set<String> dormant(JsonNode configuration, Integer skillLevel, int characterLevel,
                               String path, boolean received, boolean ownInitial) {
        List<JsonNode> rules = rows(configuration.path("triggerRules")).stream()
            .filter(rule -> "BASIC_ATTACK_RECEIVED".equals(rule.path("eventSource").path("eventType").asText())).toList();
        List<JsonNode> effects = rows(configuration.path("effects"));
        boolean declared = false;
        for (JsonNode rule : rules) for (JsonNode action : rule.path("actions")) {
            if (!"EXECUTE_EFFECT".equals(action.path("actionType").asText())) continue;
            declared |= effects.stream().filter(effect -> action.path("detail").path("effectKey").asText().equals(effect.path("effectKey").asText()))
                .flatMap(effect -> rows(effect.path("results")).stream()).anyMatch(result ->
                "COOLDOWN_CHANGE".equals(result.path("resultType").asText())
                    && "REDUCE".equals(result.path("detail").path("operation").asText()));
        }
        if (!declared) return Set.of();
        String skill = configuration.path("skill").path("skillKey").asText();
        int maximum = configuration.path("skill").path("maxLevel").asInt(0);
        if (skill.isEmpty() || !"ENABLED".equals(configuration.path("skill").path("status").asText())
            || skillLevel == null || skillLevel < 1 || skillLevel > maximum || rules.size() != 1) {
            fail(path, "纯接收维护必须来自唯一完整且已学的本技能定义");
        }
        JsonNode rule = rules.getFirst();
        String rulePath = path + ".triggerRules." + rule.path("ruleKey").asText();
        if (!rule.path("eventSource").path("detail").isObject() || !rule.path("eventSource").path("detail").isEmpty()
            || !emptyArray(rule.path("conditionGroups")) || rule.path("actions").size() != 1
            || rule.hasNonNull("oncePerUse") || rule.hasNonNull("perTargetCooldown") || rule.hasNonNull("maxTriggersPerProcess"))
            fail(rulePath, "纯接收维护不得含条件、额度、节流或额外动作");
        JsonNode action = rule.path("actions").get(0);
        String actionPath = rulePath + ".actions." + action.path("actionKey").asText();
        if (!"EXECUTE_EFFECT".equals(action.path("actionType").asText())
            || !"CURRENT_TARGET".equals(action.path("targetContext").asText())
            || !emptyArray(action.path("runtimeInputBindings")) || !emptyArray(action.path("resultModifiers")))
            fail(actionPath, "纯接收维护只执行自身即时效果，不接运行输入或动作修正");
        JsonNode effect = unique(effects, "effectKey", action.path("detail").path("effectKey").asText(), actionPath);
        if (effect.hasNonNull("lifecycle") || effect.path("results").size() != 1)
            fail(actionPath, "纯接收维护必须为即时单结果效果");
        JsonNode result = effect.path("results").get(0), detail = result.path("detail"), scope = detail.path("affectedSkillScope");
        String resultPath = path + ".effects." + effect.path("effectKey").asText() + ".results." + result.path("resultKey").asText();
        if (!"COOLDOWN_CHANGE".equals(result.path("resultType").asText()) || !"SOURCE".equals(result.path("target").asText())
            || !"REDUCE".equals(detail.path("operation").asText()) || result.hasNonNull("lifecycleBehavior")
            || result.hasNonNull("spellShieldBlockScope") || !"SKILLS".equals(scope.path("mode").asText())
            || scope.path("skillKeys").size() != 1 || !skill.equals(scope.path("skillKeys").get(0).asText())
            || !emptyArray(scope.path("skillCategoryKeys"))) fail(resultPath, "纯接收维护仅限本技能自身REDUCE范围");
        JsonNode valueRule = result.path("valueRule");
        List<BigDecimal> values = staticValues(configuration, valueRule.path("value"), maximum, skillLevel, characterLevel, resultPath);
        BigDecimal multiplier = optional(valueRule, "fixedMultiplier", BigDecimal.ONE, resultPath);
        if (multiplier.signum() < 0) fail(resultPath + ".valueRule", "维护倍率必须非负");
        BigDecimal min = optional(valueRule, "fixedMinValue", null, resultPath), max = optional(valueRule, "fixedMaxValue", null, resultPath);
        if (min != null && max != null && min.compareTo(max) > 0) fail(resultPath + ".valueRule", "维护上下限顺序不合法");
        for (BigDecimal number : values) {
            BigDecimal amount = number.multiply(multiplier);
            if (min != null) amount = amount.max(min);
            if (max != null) amount = amount.min(max);
            if (!Double.isFinite(amount.doubleValue()) || amount.compareTo(BigDecimal.valueOf(750)) != 0)
                fail(resultPath + ".valueRule", "纯接收维护全部声明等级的最终金额必须恰为750毫秒");
        }
        requireDormant(received, ownInitial, rulePath);
        return Set.of(rule.path("ruleKey").asText());
    }

    static void requireDormant(boolean received, boolean ownInitial, String path) {
        if (received && ownInitial) fail(path, "本拥有者接收普攻与INITIAL同时可达，通用接收减冷却消费者尚未实现");
    }

    private static List<BigDecimal> staticValues(JsonNode configuration, JsonNode value, int maximum,
                                                int skillLevel, int characterLevel, String path) {
        String kind = value.path("kind").asText();
        if ("FIXED".equals(kind) && value.size() == 2 && value.path("value").isNumber())
            return List.of(finite(value.path("value"), path));
        if (!"PARAMETER".equals(kind) || value.size() != 2 || !value.path("parameterKey").isTextual())
            throw SnapshotIssues.invalid(path + ".valueRule", "UNSUPPORTED_RECEIVED_COOLDOWN_MAINTENANCE", "纯接收维护只接受固定值或本技能静态参数");
        JsonNode parameter = unique(rows(configuration.path("parameters")), "parameterKey", value.path("parameterKey").textValue(), path);
        if (!configuration.path("skill").path("skillKey").asText().equals(parameter.path("skillKey").asText())
            || !configuration.path("skill").path("gameId").asText().equals(parameter.path("gameId").asText())
            || !Set.of("INTEGER", "DECIMAL").contains(parameter.path("valueType").asText())) fail(path, "维护参数必须属于本技能数值定义");
        String mode = parameter.path("valueMode").asText();
        if ("FIXED".equals(mode)) {
            if (parameter.hasNonNull("levelValues")) fail(path, "固定维护参数不得夹带等级表");
            return List.of(finite(parameter.path("fixedValue"), path));
        }
        JsonNode levels = parameter.path("levelValues");
        if (!Set.of("SKILL_LEVEL", "CHARACTER_LEVEL").contains(mode) || parameter.hasNonNull("fixedValue")
            || !levels.isObject() || levels.isEmpty()) fail(path, "维护参数必须完整静态声明且无默认输入");
        int count = "SKILL_LEVEL".equals(mode) ? maximum : levels.size();
        if (levels.size() != count || !levels.has(Integer.toString("SKILL_LEVEL".equals(mode) ? skillLevel : characterLevel)))
            fail(path, "维护参数缺少完整声明或实际等级取值");
        List<BigDecimal> result = new ArrayList<>();
        for (int i = 1; i <= count; i++) result.add(finite(levels.path(Integer.toString(i)), path));
        return result;
    }

    private static BigDecimal finite(JsonNode number, String path) {
        if (!number.isNumber() || !Double.isFinite(number.doubleValue())) fail(path, "维护参数必须为有限数值");
        return number.decimalValue();
    }
    private static BigDecimal optional(JsonNode node, String field, BigDecimal fallback, String path) {
        return node.hasNonNull(field) ? finite(node.path(field), path + ".valueRule." + field) : fallback;
    }
    private static JsonNode unique(List<JsonNode> rows, String field, String key, String path) {
        List<JsonNode> selected = rows.stream().filter(row -> key.equals(row.path(field).asText())).toList();
        if (key.isEmpty() || selected.size() != 1) fail(path, "纯接收维护的必要本技能定义缺失或重复");
        return selected.getFirst();
    }
    private static boolean emptyArray(JsonNode node) { return node.isArray() && node.isEmpty(); }
    private static List<JsonNode> rows(JsonNode node) {
        List<JsonNode> result = new ArrayList<>();
        if (node.isArray()) node.forEach(result::add);
        return result;
    }
    private static void fail(String path, String message) {
        throw SnapshotIssues.invalid(path, "UNSUPPORTED_RECEIVED_COOLDOWN_MAINTENANCE", message);
    }
}
