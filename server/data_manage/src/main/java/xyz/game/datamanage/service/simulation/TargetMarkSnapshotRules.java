package xyz.game.datamanage.service.simulation;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** 只识别完整有限目标标记作者图；缺损或混合图保留原闭包的拒绝与依赖检查。 */
final class TargetMarkSnapshotRules {
    private static final Set<String> META = Set.of("name", "description", "sortOrder", "createdAt", "updatedAt");
    private TargetMarkSnapshotRules() { }

    static boolean complete(JsonNode configuration) {
        try { recognize(configuration); return true; }
        catch (NotMarkGraph ignored) { return false; }
    }

    private static void recognize(JsonNode c) {
        need(c != null && c.isObject());
        String skill = c.path("skill").path("skillKey").asText(), game = c.path("skill").path("gameId").asText();
        need(key(skill) && !game.isEmpty());
        List<JsonNode> states = rows(c.path("internalStates"), "stateKey"), processes = rows(c.path("processes"), "processKey");
        List<JsonNode> effects = rows(c.path("effects"), "effectKey"), rules = rows(c.path("triggerRules"), "ruleKey");
        rows(c.path("parameters"), "parameterKey"); rows(c.path("formulas"), "formulaKey");
        need(states.size() == 1 && processes.size() == 4);
        JsonNode state = states.getFirst(), sd = state.path("detail");
        entity(state, "gameId", "skillKey", "stateKey", "stateType", "scope", "detail");
        fields(sd, "initialValue", "maxValue", "durationValue");
        need(owned(state, game, skill) && is(state, "stateType", "COUNTER") && is(state, "scope", "TARGET")
            && fixed(sd.path("initialValue"), 0) && staticNumber(c, sd.path("maxValue"), 1, true)
            && staticNumber(c, sd.path("durationValue"), 1, false));
        String stateKey = state.path("stateKey").asText();
        for (JsonNode p : processes) {
            entity(p, "gameId", "skillKey", "processKey", "activationType", "cooldown", "steps", "effectBindings", "stateOperations");
            need(owned(p, game, skill));
            for (JsonNode step : rows(p.path("steps"), "stepKey")) entity(step, "stepKey", "stepType", "detail", "occupiesAction");
            for (JsonNode binding : rows(p.path("effectBindings"), "bindingKey")) entity(binding, "bindingKey", "effectKey", "moment");
            for (JsonNode op : rows(p.path("stateOperations"), "operationKey")) entity(op, "operationKey", "stateSkillKey", "stateKey", "operation", "value", "optionKey", "moment");
        }
        for (JsonNode e : effects) {
            entity(e, "gameId", "skillKey", "effectKey", "lifecycle", "results");
            need(owned(e, game, skill) && nil(e.path("lifecycle")));
            for (JsonNode result : rows(e.path("results"), "resultKey")) {
                entity(result, "resultKey", "resultType", "target", "lifecycleBehavior", "spellShieldBlockScope", "valueRule", "detail");
                need(nil(result.path("lifecycleBehavior")));
                fields(result.path("valueRule"), "value", "fixedMultiplier", "fixedMinValue", "fixedMaxValue");
                need(declaredValue(c, result.path("valueRule").path("value"), is(result, "resultType", "DAMAGE"),
                    is(result, "resultType", "RESOURCE_CHANGE") && is(result.path("detail"), "operation", "CONSUME")));
                if (is(result, "resultType", "DAMAGE")) {
                    fields(result.path("detail"), "damageTypeKey", "deliveryKind", "originKind", "critical", "vampQualification", "vampOverrides");
                    fields(result.path("detail").path("critical"), "mode", "multiplierValue");
                } else {
                    need(is(result, "resultType", "RESOURCE_CHANGE")); fields(result.path("detail"), "attributeKey", "operation");
                }
            }
        }
        for (JsonNode r : rules) rule(r);
        JsonNode cast = one(processes.stream().filter(p -> is(p, "activationType", "ACTIVE")).toList());
        List<JsonNode> steps = rows(cast.path("steps"), "stepKey");
        need(steps.size() == 1 && is(steps.getFirst(), "stepType", "DELAY") && steps.getFirst().path("occupiesAction").isBoolean()
            && steps.getFirst().path("occupiesAction").booleanValue() && cast.path("stateOperations").isEmpty() && cast.hasNonNull("cooldown"));
        fields(steps.getFirst().path("detail"), "delayValue");
        need(declaredValue(c, steps.getFirst().path("detail").path("delayValue"), false, false)
            && declaredValue(c, cast.path("cooldown").path("durationValue"), false, false));
        JsonNode onUsed = one(rules.stream().filter(r -> event(r).equals("SKILL_USED")).toList());
        JsonNode used = onUsed.path("eventSource").path("detail"); fields(used, "sourceSkillKey", "useKind", "castPhase");
        need(is(used, "sourceSkillKey", skill) && is(used, "useKind", "ACTIVE") && is(used, "castPhase", "INITIAL")
            && onUsed.path("conditionGroups").isEmpty()); start(onUsed, cast);
        List<JsonNode> ownHits = rules.stream().filter(r -> skillEvent(r, skill)).toList();
        need(ownHits.size() == 2);
        JsonNode root = one(ownHits.stream().filter(r -> r.path("actions").size() == 1
            && is(r.path("actions").get(0), "actionType", "EXECUTE_EFFECT")).toList());
        JsonNode rootAction = root.path("actions").get(0);
        JsonNode zeroEffect = unique(effects, "effectKey", rootAction.path("detail").path("effectKey").asText());
        JsonNode zero = one(rows(zeroEffect.path("results"), "resultKey"));
        damage(zero, "SKILL");
        JsonNode value = zero.path("valueRule");
        need(fixed(value.path("value"), 0) && number(value.path("fixedMultiplier"), 1)
            && number(value.path("fixedMinValue"), 0) && nil(value.path("fixedMaxValue")));
        List<JsonNode> rootConditions = root.path("conditionGroups").isEmpty() ? List.of() : conditions(root);
        for (JsonNode condition : rootConditions) {
            need(is(condition, "conditionType", "TARGET_CATEGORY_CHECK")); fields(condition.path("detail"), "categories");
            JsonNode categories = condition.path("detail").path("categories"); need(categories.isArray() && !categories.isEmpty());
            Set<String> seen = new HashSet<>(); for (JsonNode category : categories) need(category.isTextual() && seen.add(category.asText()));
        }
        JsonNode application = one(ownHits.stream().filter(r -> r != root).toList());
        JsonNode applyProcess = processFor(application, processes);
        passive(applyProcess, skill, stateKey, 1); need(applyProcess.path("effectBindings").isEmpty());
        List<JsonNode> applyConditions = conditions(application);
        need(applyConditions.stream().filter(TargetMarkSnapshotRules::unblocked).count() == 1);
        List<JsonNode> remaining = applyConditions.stream().filter(condition -> !unblocked(condition)).toList();
        need(comparable(remaining).equals(comparable(rootConditions)));
        JsonNode attack = one(rules.stream().filter(r -> event(r).equals("BASIC_ATTACK_HIT")).toList());
        fields(attack.path("eventSource").path("detail"));
        List<JsonNode> siblings = rules.stream().filter(r -> event(r).equals("SKILL_HIT") && !skillEvent(r, skill)).toList();
        need(!siblings.isEmpty());
        JsonNode attackProcess = consume(attack, true, processes, effects, skill, stateKey);
        JsonNode attackEffect = effectFor(attackProcess, effects);
        need(attackEffect.path("results").size() == 1);
        JsonNode skillProcess = null, skillEffect = null;
        Set<String> siblingKeys = new HashSet<>();
        for (JsonNode r : siblings) {
            JsonNode detail = r.path("eventSource").path("detail"); fields(detail, "sourceSkillKey");
            String sibling = detail.path("sourceSkillKey").asText(); need(key(sibling) && !sibling.equals(skill) && siblingKeys.add(sibling));
            JsonNode process = consume(r, false, processes, effects, skill, stateKey), effect = effectFor(process, effects);
            if (skillProcess == null) { skillProcess = process; skillEffect = effect; }
            else need(skillProcess == process && skillEffect == effect);
        }
        need(skillProcess != attackProcess && skillEffect != attackEffect);
        List<JsonNode> restores = rows(skillEffect.path("results"), "resultKey").stream().filter(r -> is(r, "resultType", "RESOURCE_CHANGE")).toList();
        need(restores.size() <= 1 && skillEffect.path("results").size() == 1 + restores.size());
        if (!restores.isEmpty()) {
            JsonNode restore = restores.getFirst();
            need(is(restore, "target", "SOURCE") && nil(restore.path("spellShieldBlockScope")) && is(restore.path("detail"), "operation", "RESTORE")
                && key(restore.path("detail").path("attributeKey").asText()) && !is(restore.path("detail"), "attributeKey", "hp")
                && staticNumber(c, restore.path("valueRule").path("value"), 0, false));
        }
        Set<JsonNode> usedProcesses = Set.of(cast, applyProcess, attackProcess, skillProcess);
        need(usedProcesses.size() == 4 && usedProcesses.containsAll(processes));
        Set<JsonNode> usedEffects = new HashSet<>(List.of(zeroEffect, attackEffect, skillEffect));
        for (JsonNode binding : rows(cast.path("effectBindings"), "bindingKey")) {
            moment(binding.path("moment"), "PROCESS_START", null);
            JsonNode effect = unique(effects, "effectKey", binding.path("effectKey").asText());
            List<JsonNode> costs = rows(effect.path("results"), "resultKey"); need(!costs.isEmpty());
            for (JsonNode result : costs) need(is(result, "resultType", "RESOURCE_CHANGE") && is(result, "target", "SOURCE")
                && is(result.path("detail"), "operation", "CONSUME") && nil(result.path("spellShieldBlockScope")));
            usedEffects.add(effect);
        }
        need(usedEffects.size() == effects.size() && usedEffects.containsAll(effects));
        Set<JsonNode> usedRules = new HashSet<>(List.of(onUsed, root, application, attack)); usedRules.addAll(siblings);
        need(usedRules.size() == rules.size() && usedRules.containsAll(rules));
    }

    private static JsonNode consume(JsonNode rule, boolean attack, List<JsonNode> processes, List<JsonNode> effects, String skill, String state) {
        List<JsonNode> conditions = conditions(rule);
        need(conditions.size() == (attack ? 1 : 2) && conditions.stream().filter(c -> marked(c, skill, state)).count() == 1
            && (attack || conditions.stream().filter(TargetMarkSnapshotRules::unblocked).count() == 1));
        JsonNode process = processFor(rule, processes); passive(process, skill, state, 0);
        JsonNode effect = effectFor(process, effects);
        JsonNode damage = one(rows(effect.path("results"), "resultKey").stream().filter(r -> is(r, "resultType", "DAMAGE")).toList());
        damage(damage, "DAMAGE_INSTANCE"); return process;
    }
    private static JsonNode effectFor(JsonNode process, List<JsonNode> effects) {
        JsonNode binding = one(rows(process.path("effectBindings"), "bindingKey"));
        return unique(effects, "effectKey", binding.path("effectKey").asText());
    }
    private static void damage(JsonNode result, String scope) {
        JsonNode detail = result.path("detail"), critical = detail.path("critical");
        need(is(result, "resultType", "DAMAGE") && is(result, "target", "TARGET") && is(result, "spellShieldBlockScope", scope)
            && is(detail, "deliveryKind", "SKILL") && is(detail, "originKind", "DIRECT") && is(detail, "vampQualification", "RESOLVED")
            && is(critical, "mode", "DISALLOWED") && nil(critical.path("multiplierValue")));
    }
    private static void passive(JsonNode process, String skill, String state, int value) {
        need(is(process, "activationType", "PASSIVE") && nil(process.path("cooldown")));
        JsonNode step = one(rows(process.path("steps"), "stepKey")); fields(step.path("detail"));
        need(is(step, "stepType", "IMMEDIATE") && step.path("occupiesAction").isBoolean() && !step.path("occupiesAction").booleanValue());
        JsonNode operation = one(rows(process.path("stateOperations"), "operationKey"));
        need(is(operation, "stateSkillKey", skill) && is(operation, "stateKey", state) && is(operation, "operation", "SET")
            && fixed(operation.path("value"), value) && nil(operation.path("optionKey")));
        moment(operation.path("moment"), "PROCESS_START", null);
        for (JsonNode binding : rows(process.path("effectBindings"), "bindingKey")) moment(binding.path("moment"), "STEP_EXECUTION", step.path("stepKey").asText());
    }
    private static JsonNode processFor(JsonNode rule, List<JsonNode> processes) {
        JsonNode action = one(rows(rule.path("actions"), "actionKey")); need(is(action, "actionType", "START_PROCESS"));
        JsonNode process = unique(processes, "processKey", action.path("detail").path("processKey").asText()); start(rule, process); return process;
    }
    private static void start(JsonNode rule, JsonNode process) {
        JsonNode action = one(rows(rule.path("actions"), "actionKey"));
        need(is(action, "actionType", "START_PROCESS") && is(action.path("detail"), "processKey", process.path("processKey").asText()));
    }
    private static void rule(JsonNode rule) {
        entity(rule, "ruleKey", "eventSource", "conditionGroups", "actions", "perTargetCooldown", "maxTriggersPerProcess", "oncePerUse");
        need(nil(rule.path("perTargetCooldown")) && nil(rule.path("maxTriggersPerProcess")) && nil(rule.path("oncePerUse")));
        fields(rule.path("eventSource"), "eventType", "detail");
        for (JsonNode action : rows(rule.path("actions"), "actionKey")) {
            entity(action, "actionKey", "actionType", "detail", "targetContext", "runtimeInputBindings", "resultModifiers");
            need(is(action, "targetContext", "CURRENT_TARGET") && action.path("runtimeInputBindings").isArray() && action.path("runtimeInputBindings").isEmpty()
                && action.path("resultModifiers").isArray() && action.path("resultModifiers").isEmpty());
            fields(action.path("detail"), is(action, "actionType", "START_PROCESS") ? "processKey" : "effectKey");
        }
        for (JsonNode group : rows(rule.path("conditionGroups"), "groupKey")) {
            entity(group, "groupKey", "conditions");
            for (JsonNode condition : rows(group.path("conditions"), "conditionKey")) entity(condition, "conditionKey", "conditionType", "detail");
        }
    }
    private static List<JsonNode> conditions(JsonNode rule) {
        JsonNode group = one(rows(rule.path("conditionGroups"), "groupKey")); return rows(group.path("conditions"), "conditionKey");
    }
    private static List<String> comparable(List<JsonNode> conditions) {
        return conditions.stream().map(c -> c.path("conditionType").asText() + ":" + c.path("detail")).toList();
    }
    private static boolean marked(JsonNode c, String skill, String state) {
        if (!is(c, "conditionType", "INTERNAL_STATE_CHECK")) return false;
        JsonNode d = c.path("detail"); fields(d, "stateSkillKey", "stateKey", "valueKind", "optionKey", "expectedBoolean", "comparator", "comparisonValue");
        return is(d, "stateSkillKey", skill) && is(d, "stateKey", state) && is(d, "valueKind", "VALUE") && nil(d.path("optionKey"))
            && nil(d.path("expectedBoolean")) && is(d, "comparator", "EQ") && fixed(d.path("comparisonValue"), 1);
    }
    private static boolean unblocked(JsonNode c) {
        if (!is(c, "conditionType", "EVENT_VALUE_COMPARE")) return false;
        JsonNode d = c.path("detail"); fields(d, "eventValueKey", "comparator", "comparisonValue");
        return is(d, "eventValueKey", "SKILL_HIT_SPELL_SHIELD_BLOCKED") && is(d, "comparator", "EQ") && fixed(d.path("comparisonValue"), 0);
    }
    private static boolean staticNumber(JsonNode c, JsonNode value, double limit, boolean exact) {
        if (is(value, "kind", "FIXED")) { fields(value, "kind", "value"); return bounded(value.path("value"), limit, exact); }
        // 公式只核静态依赖声明；不在快照闭包执行公式，数值边界沿既有作者校验。
        if (is(value, "kind", "FORMULA")) return declaredValue(c, value, false, false);
        if (!is(value, "kind", "PARAMETER")) return false;
        fields(value, "kind", "parameterKey");
        List<JsonNode> parameters = rows(c.path("parameters"), "parameterKey");
        JsonNode p = unique(parameters, "parameterKey", value.path("parameterKey").asText());
        if (is(p, "valueMode", "FIXED")) return bounded(p.path("fixedValue"), limit, exact);
        if (!Set.of("SKILL_LEVEL", "CHARACTER_LEVEL").contains(p.path("valueMode").asText()) || !p.path("levelValues").isObject() || p.path("levelValues").isEmpty()) return false;
        return p.path("levelValues").valueStream().allMatch(n -> bounded(n, limit, exact));
    }
    private static boolean bounded(JsonNode n, double limit, boolean exact) {
        return n.isNumber() && Double.isFinite(n.doubleValue()) && (exact ? number(n, limit) : n.doubleValue() >= limit)
            && (limit != 1 || n.doubleValue() <= 9_007_199_254_740_991d && n.decimalValue().stripTrailingZeros().scale() <= 0);
    }
    private static boolean declaredValue(JsonNode c, JsonNode value, boolean attributes, boolean runtime) {
        if (is(value, "kind", "FIXED")) {
            fields(value, "kind", "value"); return value.path("value").isNumber() && Double.isFinite(value.path("value").doubleValue());
        }
        if (is(value, "kind", "PARAMETER")) {
            fields(value, "kind", "parameterKey");
            JsonNode parameter = unique(rows(c.path("parameters"), "parameterKey"), "parameterKey", value.path("parameterKey").asText());
            return declaredParameter(parameter, runtime);
        }
        if (!is(value, "kind", "FORMULA")) return false;
        fields(value, "kind", "formulaKey");
        JsonNode formula = unique(rows(c.path("formulas"), "formulaKey"), "formulaKey", value.path("formulaKey").asText());
        JsonNode expression = formula.path("expression");
        need(expression.isObject() && expression.path("inputs").isArray() && expression.path("stages").isArray() && !expression.path("stages").isEmpty());
        for (JsonNode input : expression.path("inputs")) {
            JsonNode binding = input.path("binding");
            if (is(binding, "kind", "parameter")) {
                need(is(binding, "skillKey", c.path("skill").path("skillKey").asText()));
                JsonNode parameter = unique(rows(c.path("parameters"), "parameterKey"), "parameterKey", binding.path("parameterKey").asText());
                need(declaredParameter(parameter, runtime));
            } else need(attributes && is(binding, "kind", "attribute") && is(binding, "view", "current_frame")
                && Set.of("source", "target").contains(binding.path("object").asText()) && key(binding.path("attributeKey").asText()));
        }
        return true;
    }
    private static boolean declaredParameter(JsonNode p, boolean runtime) {
        if (is(p, "valueMode", "RUNTIME_INPUT")) return runtime;
        if (is(p, "valueMode", "FIXED")) return p.path("fixedValue").isNumber() && Double.isFinite(p.path("fixedValue").doubleValue());
        return Set.of("SKILL_LEVEL", "CHARACTER_LEVEL").contains(p.path("valueMode").asText()) && p.path("levelValues").isObject()
            && !p.path("levelValues").isEmpty() && p.path("levelValues").valueStream().allMatch(n -> n.isNumber() && Double.isFinite(n.doubleValue()));
    }
    private static void moment(JsonNode node, String type, String step) {
        fields(node, "momentType", "stepKey", "failureReason");
        need(is(node, "momentType", type) && (step == null ? nil(node.path("stepKey")) : is(node, "stepKey", step)) && nil(node.path("failureReason")));
    }
    private static boolean skillEvent(JsonNode rule, String skill) {
        if (!event(rule).equals("SKILL_HIT")) return false;
        fields(rule.path("eventSource").path("detail"), "sourceSkillKey"); return is(rule.path("eventSource").path("detail"), "sourceSkillKey", skill);
    }
    private static String event(JsonNode rule) { return rule.path("eventSource").path("eventType").asText(); }
    private static boolean fixed(JsonNode node, int value) { fields(node, "kind", "value"); return is(node, "kind", "FIXED") && number(node.path("value"), value); }
    private static boolean number(JsonNode node, double value) { return node.isNumber() && node.decimalValue().compareTo(java.math.BigDecimal.valueOf(value)) == 0; }
    private static boolean is(JsonNode node, String field, String value) { return node.path(field).isTextual() && node.path(field).textValue().equals(value); }
    private static boolean owned(JsonNode node, String game, String skill) { return is(node, "gameId", game) && is(node, "skillKey", skill); }
    private static boolean nil(JsonNode node) { return node.isMissingNode() || node.isNull(); }
    private static boolean key(String value) { return value.matches("^[a-z][a-z0-9_]{0,63}$"); }
    private static List<JsonNode> rows(JsonNode node, String key) {
        need(node.isArray()); List<JsonNode> result = new ArrayList<>(); Set<String> seen = new HashSet<>();
        for (JsonNode row : node) { String id = row.path(key).asText(); need(row.isObject() && key(id) && seen.add(id)); result.add(row); } return result;
    }
    private static JsonNode unique(List<JsonNode> values, String key, String id) { return one(values.stream().filter(n -> is(n, key, id)).toList()); }
    private static JsonNode one(List<JsonNode> values) { need(values.size() == 1); return values.getFirst(); }
    private static void fields(JsonNode node, String... allowed) {
        need(node.isObject()); Set<String> keys = new HashSet<>(List.of(allowed));
        for (String key : node.propertyStream().map(java.util.Map.Entry::getKey).toList()) need(keys.contains(key));
    }
    private static void entity(JsonNode node, String... allowed) {
        Set<String> keys = new HashSet<>(META); keys.addAll(List.of(allowed)); fields(node, keys.toArray(String[]::new));
    }
    private static void need(boolean valid) { if (!valid) throw new NotMarkGraph(); }
    private static final class NotMarkGraph extends RuntimeException {
        private static final long serialVersionUID = 1L;
        private NotMarkGraph() { super(null, null, false, false); }
    }
}
