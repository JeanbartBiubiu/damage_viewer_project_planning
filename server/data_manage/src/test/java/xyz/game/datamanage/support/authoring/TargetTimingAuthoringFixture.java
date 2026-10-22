package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;

/** 完全合成作者图，不绑定任何真实英雄配置。 */
public final class TargetTimingAuthoringFixture {
    public static final String OWNER = "mark_owner", DRIVER = "actual_active";
    private TargetTimingAuthoringFixture() {}

    public static ObjectNode configuration() {
        ObjectNode config = node("{\"parameters\":[],\"formulas\":[],\"effects\":[],\"internalStates\":[],\"processes\":[],\"triggerRules\":[]}");
        ArrayNode states = config.withArray("internalStates"), processes = config.withArray("processes"), effects = config.withArray("effects"), rules = config.withArray("triggerRules");
        for (int i = 1; i <= 3; i++) {
            ObjectNode state = state("slot_" + i, 1, 4000);
            ((ObjectNode) state.path("detail")).set("targetTiming", node("{\"kind\":\"PHASED_TICK\",\"processKey\":\"pulse\",\"intervalValue\":{\"kind\":\"FIXED\",\"value\":250},\"phasePolicy\":\"PRESERVE_ON_EXTEND\"}"));
            states.add(state);
        }
        states.add(state("count", 3, 4000));
        ObjectNode pending = state("pending", 1, 2000);
        ((ObjectNode) pending.path("detail")).set("targetTiming", node("{\"kind\":\"EXPIRY_PAYLOAD\",\"processKey\":\"burst\"}"));
        states.add(pending); states.add(state("cap", 1, 4000));
        effects.add(damage("pulse_damage", 1.25)); effects.add(damage("burst_damage", 60));
        effects.add(node("""
            {"effectKey":"mana","lifecycle":null,"results":[{"resultKey":"mana","resultType":"RESOURCE_CHANGE","target":"SOURCE","sortOrder":0,
             "valueRule":{"value":{"kind":"FIXED","value":20},"fixedMultiplier":1,"fixedMinValue":0,"fixedMaxValue":null},"detail":{"attributeKey":"mana","operation":"RESTORE"}}]}
            """));
        ObjectNode pulse = process("pulse"); pulse.withArray("effectBindings").add(binding("tick", "pulse_damage", "STEP_EXECUTION", 0)); processes.add(pulse);
        ObjectNode burst = process("burst");
        for (int i = 1; i <= 3; i++) burst.withArray("stateOperations").add(operation("clear_" + i, "slot_" + i, 0, "PROCESS_START", i));
        burst.withArray("stateOperations").add(operation("clear_count", "count", 0, "PROCESS_START", 4));
        burst.withArray("effectBindings").add(binding("explode", "burst_damage", "STEP_EXECUTION", 0));
        burst.withArray("stateOperations").add(operation("cap", "cap", 1, "PROCESS_COMPLETE", 0)); processes.add(burst);
        ObjectNode renew = process("renew"); renew.withArray("stateOperations").add(operation("renew_slot", "slot_1", 1, "PROCESS_START", 0));
        renew.withArray("stateOperations").add(operation("renew_count", "count", 1, "PROCESS_START", 1)); processes.add(renew);
        ObjectNode apply = process("apply"); apply.withArray("stateOperations").add(operation("new_slot", "slot_1", 1, "PROCESS_START", 0));
        apply.withArray("stateOperations").add(operation("new_count", "count", 1, "PROCESS_START", 1)); processes.add(apply);
        ObjectNode hit = rule("apply_hit", "SKILL_HIT", node("{\"sourceSkillKey\":\"actual_active\"}"));
        hit.withArray("conditionGroups").add(group(node("{\"conditionKey\":\"unblocked\",\"conditionType\":\"EVENT_VALUE_COMPARE\",\"sortOrder\":0,\"detail\":{\"eventValueKey\":\"SKILL_HIT_SPELL_SHIELD_BLOCKED\",\"comparator\":\"EQ\",\"comparisonValue\":{\"kind\":\"FIXED\",\"value\":0}}}")));
        hit.withArray("actions").add(start("apply"));
        for (int i = 1; i <= 3; i++) hit.withArray("actions").add(node("""
            {"actionKey":"extend_%d","name":"续期","actionType":"MODIFY_INTERNAL_STATE","sortOrder":%d,"targetContext":"CURRENT_TARGET",
             "detail":{"stateSkillKey":"mark_owner","stateKey":"slot_%d","operation":"ENSURE_REMAINING_PRESERVE_PHASE","value":{"kind":"FIXED","value":4000}},"runtimeInputBindings":[],"resultModifiers":[]}
            """.formatted(i, i, i)));
        rules.add(hit);
        ObjectNode tail = rule("alive_tail", "PROCESS_MOMENT", node("{\"processKey\":\"burst\",\"moment\":{\"momentType\":\"PROCESS_COMPLETE\",\"stepKey\":null,\"failureReason\":null}}")); tail.put("sortOrder", 1);
        tail.withArray("conditionGroups").add(group(node("{\"conditionKey\":\"alive\",\"conditionType\":\"ATTRIBUTE_COMPARE\",\"sortOrder\":0,\"detail\":{\"subject\":\"CURRENT_TARGET\",\"attributeKey\":\"hp\",\"attributeValueKind\":\"CURRENT\",\"comparator\":\"GT\",\"comparisonValue\":{\"kind\":\"FIXED\",\"value\":0}}}")));
        tail.withArray("actions").add(start("renew")); rules.add(tail);
        ObjectNode refund = rule("refund", "DAMAGE_DEALT", node("{\"sourceSkillKey\":null,\"damageTypeKey\":null,\"deliveryKind\":\"ANY\",\"originKind\":\"ANY\"}"));
        ObjectNode before = node("{\"conditionKey\":\"before\",\"conditionType\":\"INTERNAL_STATE_CHECK\",\"sortOrder\":0,\"detail\":{\"stateSkillKey\":\"mark_owner\",\"stateKey\":\"count\",\"valueKind\":\"DAMAGE_BEFORE_VALUE\",\"optionKey\":null,\"expectedBoolean\":null,\"comparator\":\"GT\",\"comparisonValue\":{\"kind\":\"FIXED\",\"value\":0}}}");
        ObjectNode refundGroup = group(before); refundGroup.withArray("conditions").add(node("{\"conditionKey\":\"killed\",\"conditionType\":\"EVENT_VALUE_COMPARE\",\"sortOrder\":1,\"detail\":{\"eventValueKey\":\"KILLED\",\"comparator\":\"EQ\",\"comparisonValue\":{\"kind\":\"FIXED\",\"value\":1}}}"));
        refund.withArray("conditionGroups").add(refundGroup); refund.withArray("actions").add(node("{\"actionKey\":\"mana\",\"name\":\"回复\",\"actionType\":\"EXECUTE_EFFECT\",\"sortOrder\":0,\"targetContext\":\"EVENT_SOURCE\",\"detail\":{\"effectKey\":\"mana\"},\"runtimeInputBindings\":[],\"resultModifiers\":[]}")); rules.add(refund);
        for (String key : List.of("internalStates", "processes", "effects")) for (JsonNode row : config.path(key)) {
            ObjectNode entity = (ObjectNode) row; entity.put("gameId", "scenario").put("skillKey", OWNER).put("name", "合成机制").put("sortOrder", 0).putNull("description");
        }
        return config;
    }

    public static List<Aggregate> aggregates(ObjectNode config) {
        return aggregates(OWNER, config);
    }
    public static List<Aggregate> aggregates(String skill, ObjectNode config) {
        List<Aggregate> result = new ArrayList<>();
        add(result, skill, config, "internalStates", SourceType.STATE, "stateKey"); add(result, skill, config, "processes", SourceType.PROCESS, "processKey");
        add(result, skill, config, "effects", SourceType.EFFECT, "effectKey"); add(result, skill, config, "triggerRules", SourceType.TRIGGER, "ruleKey"); add(result, skill, config, "formulas", SourceType.FORMULA, "formulaKey");
        return result;
    }
    private static void add(List<Aggregate> out, String skill, ObjectNode config, String field, SourceType type, String key) {
        for (JsonNode row : config.path(field)) out.add(new Aggregate(type, skill, row.path(key).asText(), row));
    }
    public static ObjectNode find(ObjectNode config, String field, String keyField, String key) {
        for (JsonNode row : config.path(field)) if (row.path(keyField).asText().equals(key)) return (ObjectNode) row;
        throw new IllegalArgumentException(key);
    }
    public static ObjectNode fixed(Number value) { ObjectNode result = node("{\"kind\":\"FIXED\"}"); result.put("value", new java.math.BigDecimal(value.toString())); return result; }
    public static ObjectNode node(String json) { return (ObjectNode) AggregateJson.tree(json); }
    private static ObjectNode state(String key, int max, int duration) {
        ObjectNode state = node("{\"stateType\":\"COUNTER\",\"scope\":\"TARGET\",\"detail\":{}}"); state.put("stateKey", key);
        ObjectNode detail = (ObjectNode) state.path("detail"); detail.set("initialValue", fixed(0)); detail.set("maxValue", fixed(max)); detail.set("durationValue", fixed(duration)); return state;
    }
    private static ObjectNode process(String key) { return node("{\"processKey\":\"" + key + "\",\"activationType\":\"PASSIVE\",\"cooldown\":null,\"steps\":[{\"stepKey\":\"instant\",\"stepType\":\"IMMEDIATE\",\"occupiesAction\":false,\"detail\":{}}],\"effectBindings\":[],\"stateOperations\":[]}"); }
    private static ObjectNode operation(String key, String state, int value, String moment, int sort) {
        ObjectNode op = node("{\"name\":\"写目标计数\",\"stateSkillKey\":\"mark_owner\",\"operation\":\"SET\",\"optionKey\":null}");
        op.put("operationKey", key).put("stateKey", state).put("sortOrder", sort); op.set("value", fixed(value)); op.set("moment", moment(moment)); return op;
    }
    private static ObjectNode binding(String key, String effect, String moment, int sort) { ObjectNode result = node("{}"); result.put("bindingKey", key).put("effectKey", effect).put("sortOrder", sort); result.set("moment", moment(moment)); return result; }
    private static ObjectNode moment(String moment) { ObjectNode result = node("{}"); result.put("momentType", moment).putNull("failureReason"); if (moment.equals("PROCESS_START") || moment.equals("PROCESS_COMPLETE")) result.putNull("stepKey"); else result.put("stepKey", "instant"); return result; }
    private static ObjectNode damage(String key, double amount) { ObjectNode effect = node("""
        {"lifecycle":null,"results":[{"resultKey":"damage","name":"合成伤害","resultType":"DAMAGE","target":"TARGET","sortOrder":0,"description":null,"lifecycleBehavior":null,"spellShieldBlockScope":null,
         "detail":{"damageTypeKey":"magic","deliveryKind":"SKILL","originKind":"DIRECT","critical":{"mode":"DISALLOWED","multiplierValue":null},"vampQualification":"RESOLVED","vampOverrides":[]},
         "valueRule":{"value":{"kind":"FIXED","value":1},"fixedMultiplier":1,"fixedMinValue":0,"fixedMaxValue":null}}]}
        """); effect.put("effectKey", key); ((ObjectNode) effect.path("results").get(0).path("valueRule")).set("value", fixed(amount)); return effect; }
    private static ObjectNode rule(String key, String event, ObjectNode detail) { ObjectNode rule = node("{\"name\":\"合成触发\",\"description\":null,\"sortOrder\":0,\"conditionGroups\":[],\"actions\":[],\"perTargetCooldown\":null,\"maxTriggersPerProcess\":null,\"oncePerUse\":null}"); rule.put("ruleKey", key); rule.set("eventSource", node("{\"eventType\":\"" + event + "\"}").set("detail", detail)); return rule; }
    private static ObjectNode group(ObjectNode condition) { ObjectNode group = node("{\"groupKey\":\"checks\",\"sortOrder\":0,\"conditions\":[]}"); group.withArray("conditions").add(condition); return group; }
    private static ObjectNode start(String key) { return node("{\"actionKey\":\"start\",\"name\":\"启动\",\"actionType\":\"START_PROCESS\",\"sortOrder\":0,\"targetContext\":\"CURRENT_TARGET\",\"detail\":{\"processKey\":\"" + key + "\"},\"runtimeInputBindings\":[],\"resultModifiers\":[]}"); }
}
