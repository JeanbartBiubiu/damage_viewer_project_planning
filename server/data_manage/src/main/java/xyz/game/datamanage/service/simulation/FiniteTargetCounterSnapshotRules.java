package xyz.game.datamanage.service.simulation;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** 仅完整的有限目标计数图在未计划时休眠；混合或缺损图仍进入普通闭包检查。 */
final class FiniteTargetCounterSnapshotRules {
    private FiniteTargetCounterSnapshotRules() { }

    static boolean complete(JsonNode configuration) {
        String skill = configuration.path("skill").path("skillKey").asText();
        List<JsonNode> rules = rows(configuration.path("triggerRules"));
        List<JsonNode> states = rows(configuration.path("internalStates"));
        List<JsonNode> processes = rows(configuration.path("processes"));
        List<JsonNode> tails = rules.stream().filter(r -> event(r).equals("INTERNAL_STATE_CHANGED")).toList();
        if (skill.isEmpty() || states.size() != 2 || tails.size() != 1) return false;
        JsonNode tail = tails.getFirst(), detail = tail.path("eventSource").path("detail");
        JsonNode window = unique(states, "stateKey", detail.path("stateKey").asText());
        if (window == null || !ownCounter(window, skill) || !detail.path("stateSkillKey").asText().equals(skill)
            || !detail.path("changeKind").asText().equals("VALUE_CHANGED") || !fixed(window.path("detail").path("initialValue"), 0)
            || !fixed(window.path("detail").path("maxValue"), 1) || !window.path("detail").hasNonNull("durationValue")
            || window.path("detail").has("initialValueBinding")) return false;
        JsonNode count = states.get(0) == window ? states.get(1) : states.get(0);
        if (!ownCounter(count, skill) || !fixed(count.path("detail").path("initialValue"), 0)
            || count.path("detail").hasNonNull("durationValue") || count.path("detail").has("initialValueBinding")) return false;
        String windowKey = window.path("stateKey").asText(), countKey = count.path("stateKey").asText();
        JsonNode maximum = count.path("detail").path("maxValue");
        List<JsonNode> tailConditions = conditions(tail);
        if (tailConditions.size() != 3 || !containsEvent(tailConditions, "STATE_BEFORE", 1) || !containsEvent(tailConditions, "STATE_AFTER", 0)
            || tailConditions.stream().noneMatch(c -> stateCondition(c, skill, countKey, "LT", maximum)) || tail.path("actions").size() != 1) return false;
        JsonNode explosion = tail.path("actions").get(0);
        if (!explosion.path("actionType").asText().equals("EXECUTE_EFFECT") || !targetAction(explosion)
            || explosion.path("runtimeInputBindings").size() != 1) return false;
        JsonNode binding = explosion.path("runtimeInputBindings").get(0), bindingDetail = binding.path("detail");
        if (!binding.path("sourceType").asText().equals("INTERNAL_STATE") || !bindingDetail.path("stateSkillKey").asText().equals(skill)
            || !bindingDetail.path("stateKey").asText().equals(countKey) || !bindingDetail.path("valueKind").asText().equals("VALUE")
            || !nil(bindingDetail.path("optionKey"))) return false;
        JsonNode parameter = unique(rows(configuration.path("parameters")), "parameterKey", binding.path("parameterKey").asText());
        if (parameter == null || !parameter.path("valueMode").asText().equals("RUNTIME_INPUT") || !parameter.path("valueType").asText().equals("INTEGER")
            || !nil(parameter.path("fixedValue")) || !nil(parameter.path("levelValues"))) return false;
        List<JsonNode> fulls = rules.stream().filter(r -> event(r).equals("PROCESS_MOMENT") && conditions(r).size() == 1
            && stateCondition(conditions(r).getFirst(), skill, countKey, "EQ", maximum)).toList();
        if (fulls.size() != 1) return false;
        JsonNode full = fulls.getFirst();
        if (full.path("actions").size() != 2 || !full.path("actions").get(0).equals(explosion)) return false;
        JsonNode clearAction = full.path("actions").get(1);
        if (!startAction(clearAction)) return false;
        JsonNode clear = unique(processes, "processKey", clearAction.path("detail").path("processKey").asText());
        if (!passive(clear) || clear.path("stateOperations").size() != 1
            || !operation(clear.path("stateOperations").get(0), skill, windowKey, "SET", 0)) return false;
        JsonNode fullEvent = full.path("eventSource").path("detail");
        JsonNode stack = unique(processes, "processKey", fullEvent.path("processKey").asText());
        if (!passive(stack) || stack.path("stateOperations").size() != 1
            || !operation(stack.path("stateOperations").get(0), skill, countKey, "INCREASE", 1)
            || !fullEvent.path("moment").path("momentType").asText().equals("STEP_EXECUTION")
            || !fullEvent.path("moment").path("stepKey").asText().equals(stack.path("steps").get(0).path("stepKey").asText())
            || !nil(fullEvent.path("moment").path("failureReason"))) return false;
        String stackKey = stack.path("processKey").asText();
        List<JsonNode> stackRoots = rules.stream().filter(r -> starts(r, stackKey)).toList();
        Set<String> eventIdentities = new HashSet<>();
        if (stackRoots.isEmpty()) return false;
        for (JsonNode rule : stackRoots) {
            String type = event(rule), sibling = rule.path("eventSource").path("detail").path("sourceSkillKey").asText();
            boolean hit = type.equals("SKILL_HIT");
            List<JsonNode> checks = conditions(rule);
            if (!(type.equals("BASIC_ATTACK_HIT") || hit && !sibling.isEmpty() && !sibling.equals(skill))
                || checks.size() != (hit ? 3 : 2) || !eventIdentities.add(type + ":" + sibling)
                || checks.stream().noneMatch(c -> stateCondition(c, skill, windowKey, "EQ", fixedNode()))
                || checks.stream().noneMatch(c -> stateCondition(c, skill, countKey, "LT", maximum))
                || hit && !containsEvent(checks, "SKILL_HIT_SPELL_SHIELD_BLOCKED", 0)) return false;
        }
        List<JsonNode> applications = rules.stream().filter(r -> event(r).equals("SKILL_HIT")
            && r.path("eventSource").path("detail").path("sourceSkillKey").asText().equals(skill)
            && r.path("actions").size() == 1 && r.path("actions").get(0).path("actionType").asText().equals("START_PROCESS")).toList();
        if (applications.size() != 1) return false;
        JsonNode application = applications.getFirst(), markAction = application.path("actions").get(0);
        if (!startAction(markAction) || conditions(application).size() != 1 || !containsEvent(conditions(application), "SKILL_HIT_SPELL_SHIELD_BLOCKED", 0)) return false;
        JsonNode mark = unique(processes, "processKey", markAction.path("detail").path("processKey").asText());
        if (!passive(mark) || mark.path("stateOperations").size() != 2) return false;
        List<JsonNode> writes = new ArrayList<>(rows(mark.path("stateOperations")));
        writes.sort(Comparator.comparingInt(r -> r.path("sortOrder").asInt()));
        if (!operation(writes.get(0), skill, countKey, "SET", 0) || !operation(writes.get(1), skill, windowKey, "SET", 1)
            || writes.get(0).path("sortOrder").asInt() >= writes.get(1).path("sortOrder").asInt()) return false;
        Set<String> recognized = new HashSet<>();
        for (JsonNode rule : List.of(tail, full, application)) recognized.add(rule.path("ruleKey").asText());
        stackRoots.forEach(r -> recognized.add(r.path("ruleKey").asText()));
        int initialRoots = 0, hitRoots = 0;
        String castKey = null;
        for (JsonNode rule : rules) {
            if (!nil(rule.path("oncePerUse")) || !nil(rule.path("perTargetCooldown")) || !nil(rule.path("maxTriggersPerProcess"))) return false;
            if (recognized.contains(rule.path("ruleKey").asText())) continue;
            JsonNode eventDetail = rule.path("eventSource").path("detail");
            if (event(rule).equals("SKILL_USED") && eventDetail.path("sourceSkillKey").asText().equals(skill)
                && eventDetail.path("castPhase").asText().equals("INITIAL") && eventDetail.path("useKind").asText().equals("ACTIVE")
                && rule.path("conditionGroups").isEmpty() && rule.path("actions").size() == 1 && startAction(rule.path("actions").get(0))) {
                castKey = rule.path("actions").get(0).path("detail").path("processKey").asText();
                JsonNode cast = unique(processes, "processKey", castKey);
                if (cast == null || !cast.path("activationType").asText().equals("ACTIVE") || !cast.path("stateOperations").isEmpty()) return false;
                initialRoots++;
            }
            else if (event(rule).equals("SKILL_HIT") && eventDetail.path("sourceSkillKey").asText().equals(skill)
                && rule.path("conditionGroups").isEmpty() && rule.path("actions").size() == 1
                && rule.path("actions").get(0).path("actionType").asText().equals("EXECUTE_EFFECT")
                && targetAction(rule.path("actions").get(0)) && rule.path("actions").get(0).path("runtimeInputBindings").isEmpty()) {
                JsonNode effect = unique(rows(configuration.path("effects")), "effectKey", rule.path("actions").get(0).path("detail").path("effectKey").asText());
                if (effect == null || !nil(effect.path("lifecycle")) || effect.path("results").size() != 1) return false;
                JsonNode result = effect.path("results").get(0), damage = result.path("detail");
                if (!result.path("resultType").asText().equals("DAMAGE") || !result.path("target").asText().equals("TARGET")
                    || !result.path("spellShieldBlockScope").asText().equals("SKILL") || !fixed(result.path("valueRule").path("value"), 0)
                    || !damage.path("critical").path("mode").asText().equals("DISALLOWED") || !damage.path("deliveryKind").asText().equals("SKILL")
                    || !damage.path("originKind").asText().equals("DIRECT") || !damage.path("vampQualification").asText().equals("RESOLVED")) return false;
                hitRoots++;
            }
            else return false;
        }
        Set<String> writerProcesses = new HashSet<>(List.of(mark.path("processKey").asText(), stack.path("processKey").asText(), clear.path("processKey").asText()));
        if (writerProcesses.size() != 3 || castKey == null || writerProcesses.contains(castKey)) return false;
        for (JsonNode process : processes) {
            if (writerProcesses.contains(process.path("processKey").asText())) continue;
            for (JsonNode write : process.path("stateOperations")) {
                if (write.path("stateSkillKey").asText().equals(skill)
                    && Set.of(countKey, windowKey).contains(write.path("stateKey").asText())) return false;
            }
        }
        return initialRoots == 1 && hitRoots == 1;
    }
    private static JsonNode fixedNode() { return com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode().put("kind", "FIXED").put("value", 1); }
    private static boolean ownCounter(JsonNode s, String skill) { return s.path("skillKey").asText().equals(skill) && s.path("stateType").asText().equals("COUNTER") && s.path("scope").asText().equals("TARGET"); }
    private static boolean passive(JsonNode p) { return p != null && p.path("activationType").asText().equals("PASSIVE") && nil(p.path("cooldown")) && p.path("effectBindings").isEmpty() && p.path("steps").size() == 1 && p.path("steps").get(0).path("stepType").asText().equals("IMMEDIATE") && p.path("steps").get(0).path("occupiesAction").isBoolean() && !p.path("steps").get(0).path("occupiesAction").asBoolean(); }
    private static boolean starts(JsonNode r, String process) { return r.path("actions").size() == 1 && startAction(r.path("actions").get(0)) && r.path("actions").get(0).path("detail").path("processKey").asText().equals(process); }
    private static boolean startAction(JsonNode a) { return a.path("actionType").asText().equals("START_PROCESS") && targetAction(a) && a.path("runtimeInputBindings").isEmpty(); }
    private static boolean targetAction(JsonNode a) { return a.path("targetContext").asText().equals("CURRENT_TARGET") && a.path("resultModifiers").isEmpty(); }
    private static boolean operation(JsonNode o, String skill, String key, String op, int value) { return o.path("stateSkillKey").asText().equals(skill) && o.path("stateKey").asText().equals(key) && o.path("operation").asText().equals(op) && fixed(o.path("value"), value) && nil(o.path("optionKey")) && o.path("moment").path("momentType").asText().equals("PROCESS_START") && nil(o.path("moment").path("stepKey")) && nil(o.path("moment").path("failureReason")); }
    private static boolean containsEvent(List<JsonNode> list, String key, int value) { return list.stream().anyMatch(c -> c.path("conditionType").asText().equals("EVENT_VALUE_COMPARE") && c.path("detail").path("eventValueKey").asText().equals(key) && c.path("detail").path("comparator").asText().equals("EQ") && fixed(c.path("detail").path("comparisonValue"), value)); }
    private static boolean stateCondition(JsonNode c, String skill, String key, String comparator, JsonNode value) { JsonNode d = c.path("detail"); return c.path("conditionType").asText().equals("INTERNAL_STATE_CHECK") && d.path("stateSkillKey").asText().equals(skill) && d.path("stateKey").asText().equals(key) && d.path("valueKind").asText().equals("VALUE") && nil(d.path("optionKey")) && nil(d.path("expectedBoolean")) && d.path("comparator").asText().equals(comparator) && sameNumeric(d.path("comparisonValue"), value); }
    private static boolean sameNumeric(JsonNode a, JsonNode b) { return a.path("kind").asText().equals("FIXED") && b.path("kind").asText().equals("FIXED") && a.path("value").isNumber() && b.path("value").isNumber() ? a.path("value").decimalValue().compareTo(b.path("value").decimalValue()) == 0 : a.equals(b); }
    private static List<JsonNode> conditions(JsonNode rule) { return rule.path("conditionGroups").size() == 1 ? rows(rule.path("conditionGroups").get(0).path("conditions")) : List.of(); }
    private static String event(JsonNode rule) { return rule.path("eventSource").path("eventType").asText(); }
    private static boolean fixed(JsonNode n, int value) { return n.path("kind").asText().equals("FIXED") && n.path("value").isNumber() && n.path("value").decimalValue().compareTo(java.math.BigDecimal.valueOf(value)) == 0; }
    private static boolean nil(JsonNode n) { return n.isNull() || n.isMissingNode(); }
    private static JsonNode unique(List<JsonNode> rows, String field, String key) { List<JsonNode> found = rows.stream().filter(r -> r.path(field).asText().equals(key)).toList(); return found.size() == 1 ? found.getFirst() : null; }
    private static List<JsonNode> rows(JsonNode n) { List<JsonNode> result = new ArrayList<>(); if (n.isArray()) n.forEach(result::add); return result; }
}
