package xyz.game.datamanage.service.simulation;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** 仅识别完整的伤前目标标记、原额派生伤害图；不授予任何来源执行资格。 */
final class RawDamageMarkSnapshotRules {
    private static final Set<String> META = Set.of("name", "description", "sortOrder", "createdAt", "updatedAt");
    private RawDamageMarkSnapshotRules() { }

    static boolean declared(JsonNode configuration) {
        for (JsonNode rule : configuration.path("triggerRules")) for (JsonNode action : rule.path("actions"))
            for (JsonNode binding : action.path("runtimeInputBindings"))
                if (is(binding, "sourceType", "EVENT_VALUE") && is(binding.path("detail"), "eventValueKey", "RAW_DAMAGE")) return true;
        return false;
    }

    static boolean complete(JsonNode configuration, int skillLevel, int characterLevel) {
        try { recognize(configuration, skillLevel, characterLevel); return true; }
        catch (NotThisGraph ignored) { return false; }
    }

    private static void recognize(JsonNode c, int level, int characterLevel) {
        String skill = c.path("skill").path("skillKey").asText(), game = c.path("skill").path("gameId").asText();
        need(key(skill) && !game.isEmpty() && level > 0 && level <= c.path("skill").path("maxLevel").asInt());
        List<JsonNode> states = rows(c.path("internalStates"), "stateKey"), processes = rows(c.path("processes"), "processKey");
        List<JsonNode> effects = rows(c.path("effects"), "effectKey"), rules = rows(c.path("triggerRules"), "ruleKey");
        List<JsonNode> parameters = rows(c.path("parameters"), "parameterKey"), formulas = rows(c.path("formulas"), "formulaKey");
        need(states.size() == 1 && processes.size() == 1 && effects.size() == 1 && rules.size() == 4 && parameters.size() == 3 && formulas.size() == 1);
        for (List<JsonNode> collection : List.of(states, processes, effects, parameters, formulas))
            for (JsonNode row : collection) need(is(row, "gameId", game) && is(row, "skillKey", skill));
        JsonNode state = states.getFirst(), detail = state.path("detail");
        entity(state, "gameId", "skillKey", "stateKey", "scope", "stateType", "detail");
        fields(detail, "initialValue", "maxValue", "durationValue");
        need(is(state, "scope", "TARGET") && is(state, "stateType", "COUNTER") && fixed(detail.path("initialValue"), 0) && fixed(detail.path("maxValue"), 1));
        JsonNode duration = parameter(parameters, detail.path("durationValue"));
        need(is(duration, "valueType", "INTEGER"));
        BigDecimal durationMs = staticParameter(duration, level, characterLevel);
        need(durationMs.signum() > 0 && durationMs.stripTrailingZeros().scale() <= 0 && durationMs.compareTo(BigDecimal.valueOf(9_007_199_254_740_991L)) <= 0);
        String stateKey = state.path("stateKey").asText();

        JsonNode process = processes.getFirst();
        entity(process, "gameId", "skillKey", "processKey", "activationType", "cooldown", "steps", "effectBindings", "stateOperations");
        need(is(process, "activationType", "PASSIVE") && nil(process.path("cooldown")) && empty(process.path("effectBindings")));
        JsonNode step = only(rows(process.path("steps"), "stepKey"));
        entity(step, "stepKey", "stepType", "occupiesAction", "detail"); fields(step.path("detail"));
        need(is(step, "stepType", "IMMEDIATE") && step.path("occupiesAction").isBoolean() && !step.path("occupiesAction").booleanValue());
        JsonNode write = only(rows(process.path("stateOperations"), "operationKey"));
        entity(write, "operationKey", "stateSkillKey", "stateKey", "operation", "value", "optionKey", "moment");
        need(is(write, "stateSkillKey", skill) && is(write, "stateKey", stateKey) && is(write, "operation", "SET") && fixed(write.path("value"), 1) && nil(write.path("optionKey")));
        moment(write.path("moment"), step.path("stepKey").asText());

        JsonNode effect = effects.getFirst(); entity(effect, "gameId", "skillKey", "effectKey", "lifecycle", "results");
        need(nil(effect.path("lifecycle")));
        JsonNode result = only(rows(effect.path("results"), "resultKey"));
        entity(result, "resultKey", "resultType", "target", "lifecycleBehavior", "spellShieldBlockScope", "valueRule", "detail");
        need(is(result, "resultType", "DAMAGE") && is(result, "target", "TARGET") && nil(result.path("lifecycleBehavior")) && nil(result.path("spellShieldBlockScope")));
        JsonNode damage = result.path("detail"); fields(damage, "damageTypeKey", "deliveryKind", "originKind", "critical", "vampQualification", "vampOverrides");
        fields(damage.path("critical"), "mode", "multiplierValue");
        need(is(damage, "damageTypeKey", "true") && is(damage, "deliveryKind", "SKILL") && is(damage, "originKind", "DIRECT")
            && is(damage, "vampQualification", "RESOLVED") && empty(damage.path("vampOverrides")) && is(damage.path("critical"), "mode", "DISALLOWED")
            && nil(damage.path("critical").path("multiplierValue")));
        JsonNode value = result.path("valueRule"); fields(value, "value", "fixedMultiplier", "fixedMinValue", "fixedMaxValue");
        need(number(value.path("fixedMultiplier"), 1) && number(value.path("fixedMinValue"), 0) && nil(value.path("fixedMaxValue")));
        fields(value.path("value"), "kind", "formulaKey"); need(is(value.path("value"), "kind", "FORMULA"));
        JsonNode formula = formulas.getFirst(); entity(formula, "gameId", "skillKey", "formulaKey", "expression");
        need(is(formula, "formulaKey", value.path("value").path("formulaKey").asText()));

        JsonNode magic = only(rules.stream().filter(rule -> event(rule).equals("DAMAGE_DEALT") && nil(rule.path("eventSource").path("detail").path("sourceSkillKey"))).toList());
        JsonNode primary = only(rules.stream().filter(rule -> event(rule).equals("DAMAGE_DEALT") && is(rule.path("eventSource").path("detail"), "deliveryKind", "BASIC_ATTACK")).toList());
        JsonNode refresh = only(rules.stream().filter(rule -> event(rule).equals("DAMAGE_DEALT") && is(rule.path("eventSource").path("detail"), "deliveryKind", "SKILL")).toList());
        JsonNode hit = only(rules.stream().filter(rule -> event(rule).equals("SKILL_HIT")).toList());
        need(new HashSet<>(List.of(magic, primary, refresh, hit)).size() == 4);
        for (JsonNode rule : rules) rule(rule);
        damageEvent(magic, null, "magic", "ANY", "ANY");
        String primarySkill = primary.path("eventSource").path("detail").path("sourceSkillKey").asText();
        String refreshSkill = refresh.path("eventSource").path("detail").path("sourceSkillKey").asText();
        String hitSkill = hit.path("eventSource").path("detail").path("sourceSkillKey").asText();
        need(key(primarySkill) && key(refreshSkill) && key(hitSkill) && new HashSet<>(List.of(skill, primarySkill, refreshSkill, hitSkill)).size() == 4);
        damageEvent(primary, primarySkill, "physics", "BASIC_ATTACK", "DIRECT");
        damageEvent(refresh, refreshSkill, "magic", "SKILL", "ANY");
        fields(hit.path("eventSource").path("detail"), "sourceSkillKey");
        before(only(conditions(primary)), skill, stateKey, "GTE", 0);
        before(only(conditions(magic)), skill, stateKey, "EQ", 1);
        before(only(conditions(refresh)), skill, stateKey, "EQ", 1);
        List<JsonNode> hitConditions = conditions(hit); need(hitConditions.size() == 2);
        JsonNode enemy = only(hitConditions.stream().filter(row -> is(row, "conditionType", "SKILL_HIT_TARGET_IS_ENEMY")).toList()); fields(enemy.path("detail"));
        JsonNode unblocked = only(hitConditions.stream().filter(row -> is(row, "conditionType", "EVENT_VALUE_COMPARE")).toList());
        fields(unblocked.path("detail"), "eventValueKey", "comparator", "comparisonValue");
        need(is(unblocked.path("detail"), "eventValueKey", "SKILL_HIT_SPELL_SHIELD_BLOCKED") && is(unblocked.path("detail"), "comparator", "EQ") && fixed(unblocked.path("detail").path("comparisonValue"), 0));
        for (JsonNode rule : List.of(primary, refresh, hit)) {
            JsonNode action = only(rows(rule.path("actions"), "actionKey")); action(action); fields(action.path("detail"), "processKey");
            need(is(action, "actionType", "START_PROCESS") && is(action.path("detail"), "processKey", process.path("processKey").asText()) && empty(action.path("runtimeInputBindings")));
        }
        JsonNode execute = only(rows(magic.path("actions"), "actionKey")); action(execute); fields(execute.path("detail"), "effectKey");
        need(is(execute, "actionType", "EXECUTE_EFFECT") && is(execute.path("detail"), "effectKey", effect.path("effectKey").asText()));
        JsonNode binding = only(rows(execute.path("runtimeInputBindings"), "bindingKey")); fields(binding, "bindingKey", "parameterKey", "sourceType", "detail");
        fields(binding.path("detail"), "eventValueKey"); need(is(binding, "sourceType", "EVENT_VALUE") && is(binding.path("detail"), "eventValueKey", "RAW_DAMAGE"));
        JsonNode raw = unique(parameters, "parameterKey", binding.path("parameterKey").asText());
        entity(raw, "gameId", "skillKey", "parameterKey", "valueType", "valueMode", "fixedValue", "levelValues");
        need(is(raw, "valueType", "DECIMAL") && is(raw, "valueMode", "RUNTIME_INPUT") && nil(raw.path("fixedValue")) && nil(raw.path("levelValues")));
        JsonNode ratio = only(parameters.stream().filter(row -> row != raw && row != duration).toList());
        need(is(ratio, "valueType", "DECIMAL") && staticParameter(ratio, level, characterLevel).signum() >= 0);
        multiplyFormula(formula.path("expression"), skill, raw.path("parameterKey").asText(), ratio.path("parameterKey").asText());
    }

    private static void multiplyFormula(JsonNode expression, String skill, String raw, String ratio) {
        fields(expression, "inputs", "stages", "outputStageKey");
        List<JsonNode> inputs = rows(expression.path("inputs"), "key"); need(inputs.size() == 2);
        Set<String> parameters = new HashSet<>(), reads = new HashSet<>();
        for (JsonNode input : inputs) {
            fields(input, "key", "binding"); fields(input.path("binding"), "kind", "skillKey", "parameterKey");
            need(is(input.path("binding"), "kind", "parameter") && is(input.path("binding"), "skillKey", skill));
            parameters.add(input.path("binding").path("parameterKey").asText()); reads.add(input.path("key").asText());
        }
        need(parameters.equals(Set.of(raw, ratio)));
        JsonNode stage = only(rows(expression.path("stages"), "key")); entity(stage, "key", "expression");
        need(is(expression, "outputStageKey", stage.path("key").asText()));
        JsonNode multiplication = stage.path("expression"); fields(multiplication, "op", "args");
        need(is(multiplication, "op", "mul") && multiplication.path("args").isArray() && multiplication.path("args").size() == 2);
        Set<String> actualReads = new HashSet<>();
        for (JsonNode arg : multiplication.path("args")) { fields(arg, "op", "inputKey"); need(is(arg, "op", "read")); actualReads.add(arg.path("inputKey").asText()); }
        need(actualReads.equals(reads));
    }

    private static void rule(JsonNode rule) {
        entity(rule, "ruleKey", "eventSource", "conditionGroups", "actions", "perTargetCooldown", "maxTriggersPerProcess", "oncePerUse");
        fields(rule.path("eventSource"), "eventType", "detail");
        need(nil(rule.path("perTargetCooldown")) && nil(rule.path("maxTriggersPerProcess")) && nil(rule.path("oncePerUse")));
        for (JsonNode condition : conditions(rule)) entity(condition, "conditionKey", "conditionType", "detail");
    }
    private static List<JsonNode> conditions(JsonNode rule) {
        JsonNode group = only(rows(rule.path("conditionGroups"), "groupKey")); entity(group, "groupKey", "conditions");
        return rows(group.path("conditions"), "conditionKey");
    }
    private static void action(JsonNode action) {
        entity(action, "actionKey", "actionType", "detail", "targetContext", "runtimeInputBindings", "resultModifiers");
        need(is(action, "targetContext", "CURRENT_TARGET") && empty(action.path("resultModifiers")));
    }
    private static void damageEvent(JsonNode rule, String skill, String type, String delivery, String origin) {
        JsonNode detail = rule.path("eventSource").path("detail"); fields(detail, "sourceSkillKey", "damageTypeKey", "deliveryKind", "originKind");
        need((skill == null ? nil(detail.path("sourceSkillKey")) : is(detail, "sourceSkillKey", skill)) && is(detail, "damageTypeKey", type) && is(detail, "deliveryKind", delivery) && is(detail, "originKind", origin));
    }
    private static void before(JsonNode condition, String skill, String state, String comparator, int value) {
        JsonNode detail = condition.path("detail"); fields(detail, "stateSkillKey", "stateKey", "valueKind", "optionKey", "expectedBoolean", "comparator", "comparisonValue");
        need(is(condition, "conditionType", "INTERNAL_STATE_CHECK") && is(detail, "stateSkillKey", skill) && is(detail, "stateKey", state) && is(detail, "valueKind", "DAMAGE_BEFORE_VALUE")
            && nil(detail.path("optionKey")) && nil(detail.path("expectedBoolean")) && is(detail, "comparator", comparator) && fixed(detail.path("comparisonValue"), value));
    }
    private static void moment(JsonNode moment, String step) {
        need(moment.isObject());
        Set<String> names = new HashSet<>(); moment.fieldNames().forEachRemaining(names::add);
        names.remove("failureReason"); need(names.equals(Set.of("momentType", "stepKey")) && nil(moment.path("failureReason")) && is(moment, "momentType", "STEP_EXECUTION") && is(moment, "stepKey", step));
    }
    private static JsonNode parameter(List<JsonNode> parameters, JsonNode value) { fields(value, "kind", "parameterKey"); need(is(value, "kind", "PARAMETER")); return unique(parameters, "parameterKey", value.path("parameterKey").asText()); }
    private static BigDecimal staticParameter(JsonNode parameter, int level, int characterLevel) {
        entity(parameter, "gameId", "skillKey", "parameterKey", "valueType", "valueMode", "fixedValue", "levelValues");
        String mode = parameter.path("valueMode").asText(); JsonNode value;
        if (mode.equals("FIXED")) { need(nil(parameter.path("levelValues"))); value = parameter.path("fixedValue"); }
        else { need(Set.of("SKILL_LEVEL", "CHARACTER_LEVEL").contains(mode) && nil(parameter.path("fixedValue")) && parameter.path("levelValues").isObject()); value = parameter.path("levelValues").path(Integer.toString(mode.equals("SKILL_LEVEL") ? level : characterLevel)); }
        need(value.isNumber() && Double.isFinite(value.doubleValue())); return value.decimalValue();
    }
    private static JsonNode unique(List<JsonNode> rows, String field, String value) { return only(rows.stream().filter(row -> is(row, field, value)).toList()); }
    private static JsonNode only(List<JsonNode> rows) { need(rows.size() == 1); return rows.getFirst(); }
    private static List<JsonNode> rows(JsonNode node, String key) { need(node.isArray()); List<JsonNode> result = new ArrayList<>(); Set<String> keys = new HashSet<>(); for (JsonNode row : node) { need(row.isObject() && key(row.path(key).asText()) && keys.add(row.path(key).asText())); result.add(row); } return result; }
    private static void entity(JsonNode node, String... required) { shape(node, true, required); }
    private static void fields(JsonNode node, String... required) { shape(node, false, required); }
    private static void shape(JsonNode node, boolean metadata, String... required) { need(node.isObject()); Set<String> keys = new HashSet<>(); node.fieldNames().forEachRemaining(keys::add); if (metadata) keys.removeAll(META); need(keys.equals(Set.of(required))); }
    private static String event(JsonNode rule) { return rule.path("eventSource").path("eventType").asText(); }
    private static boolean key(String value) { return value.matches("^[a-z][a-z0-9_]{0,63}$"); }
    private static boolean is(JsonNode node, String key, String value) { return node != null && node.path(key).isTextual() && node.path(key).asText().equals(value); }
    private static boolean nil(JsonNode node) { return node.isNull() || node.isMissingNode(); }
    private static boolean empty(JsonNode node) { return node.isArray() && node.isEmpty(); }
    private static boolean number(JsonNode node, int number) { return node.isNumber() && node.decimalValue().compareTo(BigDecimal.valueOf(number)) == 0; }
    private static boolean fixed(JsonNode node, int number) { fields(node, "kind", "value"); return is(node, "kind", "FIXED") && number(node.path("value"), number); }
    private static void need(boolean value) { if (!value) throw new NotThisGraph(); }
    private static final class NotThisGraph extends RuntimeException { private static final long serialVersionUID = 1L; }
}
