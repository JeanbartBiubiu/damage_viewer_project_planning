package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

/** 新开放的无直接行为被动过程必须有真实时点的可达叶动作，不判断数值条件是否恒真。 */
public final class SkillProcessBehaviorSemantics {
    private record Key(String skill, String key) {}

    private SkillProcessBehaviorSemantics() {}

    /** 使用最终完整作者图；删除的规则或叶行为不能通过旧引用继续提供行为。 */
    public static void validate(Set<String> changedSkills, List<Aggregate> context) {
        Map<Key, Aggregate> processes = new LinkedHashMap<>(), effects = new LinkedHashMap<>(), states = new LinkedHashMap<>();
        Map<Key, List<JsonNode>> momentRules = new LinkedHashMap<>();
        for (Aggregate item : context) {
            Key key = new Key(item.skillKey(), item.key());
            switch (item.type()) {
                case PROCESS -> processes.put(key, item);
                case EFFECT -> effects.put(key, item);
                case STATE -> states.put(key, item);
                default -> { }
            }
        }
        for (Aggregate item : context) {
            if (item.type() != SourceType.TRIGGER
                || !"PROCESS_MOMENT".equals(item.data().path("eventSource").path("eventType").asText())) continue;
            JsonNode event = item.data().path("eventSource").path("detail");
            Key key = new Key(item.skillKey(), event.path("processKey").asText());
            Aggregate process = processes.get(key);
            if (process != null && reachableMoment(process.data(), event.path("moment"))) {
                momentRules.computeIfAbsent(key, ignored -> new ArrayList<>()).add(item.data());
            }
        }
        Set<Key> withBehavior = new LinkedHashSet<>();
        processes.forEach((key, item) -> { if (directBehavior(item.data())) withBehavior.add(key); });
        // 只把已证实有叶行为的过程逐层纳入；纯自指或互指无法成为第一片叶子。
        boolean expanded;
        do {
            expanded = false;
            for (var entry : processes.entrySet()) {
                Key key = entry.getKey();
                if (withBehavior.contains(key) || !finiteUnoccupiedPassive(entry.getValue().data())) continue;
                for (JsonNode rule : momentRules.getOrDefault(key, List.of())) {
                    if (hasLeafAction(key.skill(), rule.path("actions"), withBehavior, effects, states)) {
                        expanded |= withBehavior.add(key);
                        break;
                    }
                }
            }
        } while (expanded);
        for (var entry : processes.entrySet()) {
            if (changedSkills.contains(entry.getKey().skill())
                && "PASSIVE".equals(entry.getValue().data().path("activationType").asText())
                && !withBehavior.contains(entry.getKey())) {
                Aggregate item = entry.getValue();
                Map<String, String> issue = Map.of("field", "effectBindings", "code", "PROCESS_BEHAVIOR_REQUIRED",
                    "message", "过程需要直接行为，或明确不占用行动的有限被动过程及其真实时点可达叶动作",
                    "sourceSkillKey", item.skillKey(), "sourceType", "PROCESS", "sourceKey", item.key());
                throw new ApiException(HttpStatus.BAD_REQUEST, "400.VALIDATION_FAILED", "技能过程缺少完整行为",
                    Map.of("fieldIssues", List.of(issue)));
            }
        }
    }

    private static boolean directBehavior(JsonNode process) {
        JsonNode cooldown = process.get("cooldown");
        return cooldown != null && !cooldown.isNull()
            || nonEmpty(process.path("effectBindings")) || nonEmpty(process.path("stateOperations"));
    }

    private static boolean finiteUnoccupiedPassive(JsonNode process) {
        if (!"PASSIVE".equals(process.path("activationType").asText()) || !nonEmpty(process.path("steps"))) return false;
        for (JsonNode step : process.path("steps")) {
            if (!Set.of("IMMEDIATE", "DELAY").contains(step.path("stepType").asText())
                || !step.path("occupiesAction").isBoolean() || step.path("occupiesAction").booleanValue()) return false;
        }
        return true;
    }

    private static boolean reachableMoment(JsonNode process, JsonNode moment) {
        if (!moment.isObject() || moment.hasNonNull("failureReason")) return false;
        String type = moment.path("momentType").asText();
        if (Set.of("PROCESS_START", "PROCESS_COMPLETE").contains(type)) return !moment.hasNonNull("stepKey");
        if (!Set.of("STEP_START", "STEP_EXECUTION", "STEP_COMPLETE").contains(type)) return false;
        for (JsonNode step : process.path("steps")) {
            if (step.path("stepKey").asText().equals(moment.path("stepKey").asText())) return true;
        }
        return false;
    }

    private static boolean hasLeafAction(String skill, JsonNode actions, Set<Key> processes,
                                         Map<Key, Aggregate> effects, Map<Key, Aggregate> states) {
        for (JsonNode action : actions) {
            JsonNode detail = action.path("detail");
            switch (action.path("actionType").asText()) {
                case "START_PROCESS" -> {
                    if (processes.contains(new Key(skill, detail.path("processKey").asText()))) return true;
                }
                case "EXECUTE_EFFECT" -> {
                    Aggregate effect = effects.get(new Key(skill, detail.path("effectKey").asText()));
                    if (effect != null && nonEmpty(effect.data().path("results"))) return true;
                }
                case "MODIFY_INTERNAL_STATE" -> {
                    if (states.containsKey(new Key(detail.path("stateSkillKey").asText(), detail.path("stateKey").asText()))) return true;
                }
                default -> { }
            }
        }
        return false;
    }

    private static boolean nonEmpty(JsonNode node) { return node.isArray() && !node.isEmpty(); }
}
