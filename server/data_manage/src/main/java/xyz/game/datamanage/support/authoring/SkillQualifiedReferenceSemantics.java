package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

/** 被引用定义改种类时，跨技能读取仍按实际目标复核，不只检查键是否存在。 */
public final class SkillQualifiedReferenceSemantics {
    private SkillQualifiedReferenceSemantics() {}

    public static void validate(List<Aggregate> sources, List<Aggregate> context) {
        Map<String, Aggregate> states = new LinkedHashMap<>(), effects = new LinkedHashMap<>();
        for (Aggregate aggregate : context) {
            if (aggregate.type() == SourceType.STATE) states.put(id(aggregate.skillKey(), aggregate.key()), aggregate);
            if (aggregate.type() == SourceType.EFFECT) effects.put(id(aggregate.skillKey(), aggregate.key()), aggregate);
        }
        for (Aggregate source : sources) {
            if (source.type() == SourceType.PROCESS) {
                int index = 0;
                for (JsonNode operation : source.data().path("stateOperations")) {
                    Aggregate state = state(source, operation, states);
                    if (state != null) operation(source, operation, state, "stateOperations[" + index + "]");
                    index++;
                }
            }
            if (source.type() != SourceType.TRIGGER) continue;
            JsonNode event = source.data().path("eventSource");
            if ("INTERNAL_STATE_CHANGED".equals(event.path("eventType").asText()))
                stateRead(source, event.path("detail"), states, "changeKind", "eventSource.detail");
            int groupIndex = 0;
            for (JsonNode group : source.data().path("conditionGroups")) {
                int conditionIndex = 0;
                for (JsonNode condition : group.path("conditions")) {
                    String path = "conditionGroups[" + groupIndex + "].conditions[" + conditionIndex + "].detail";
                    JsonNode detail = condition.path("detail");
                    switch (condition.path("conditionType").asText()) {
                        case "STATUS_CHECK" -> statusRead(source, detail, effects, path);
                        case "INTERNAL_STATE_CHECK" -> stateRead(source, detail, states, "valueKind", path);
                        default -> { }
                    }
                    conditionIndex++;
                }
                groupIndex++;
            }
            int actionIndex = 0;
            for (JsonNode action : source.data().path("actions")) {
                int bindingIndex = 0;
                for (JsonNode binding : action.path("runtimeInputBindings")) {
                    String path = "actions[" + actionIndex + "].runtimeInputBindings[" + bindingIndex + "].detail";
                    JsonNode detail = binding.path("detail");
                    switch (binding.path("sourceType").asText()) {
                        case "COMBAT_STATUS" -> statusRead(source, detail, effects, path);
                        case "INTERNAL_STATE" -> stateRead(source, detail, states, "valueKind", path);
                        default -> { }
                    }
                    bindingIndex++;
                }
                actionIndex++;
            }
        }
    }

    private static void statusRead(Aggregate source, JsonNode detail, Map<String, Aggregate> effects, String path) {
        if (!detail.hasNonNull("sourceEffectKey")) return;
        String skill = owner(source, detail, "effectSkillKey");
        Aggregate effect = effects.get(id(skill, detail.path("sourceEffectKey").asText()));
        if (effect == null) throw invalid(source, path + ".sourceEffectKey", "来源效果不存在");
        JsonNode selected = null;
        for (JsonNode result : effect.data().path("results")) {
            if (detail.path("sourceResultKey").asText().equals(result.path("resultKey").asText())) {
                if (selected != null) throw invalid(source, path + ".sourceResultKey", "来源结果标识重复");
                selected = result;
            }
        }
        if (selected == null || !effect.data().path("lifecycle").isObject()
            || !"STATUS_OPERATION".equals(selected.path("resultType").asText())
            || !"APPLY".equals(selected.path("detail").path("operation").asText())
            || !detail.path("statusKey").asText().equals(selected.path("detail").path("statusKey").asText())
            || !"PERSISTENT".equals(selected.path("lifecycleBehavior").path("moment").asText())) {
            throw invalid(source, path + ".sourceResultKey", "状态层数或剩余时间必须读取同一状态身份的持续施加结果");
        }
    }

    private static Aggregate state(Aggregate source, JsonNode detail, Map<String, Aggregate> states) {
        return states.get(id(owner(source, detail, "stateSkillKey"), detail.path("stateKey").asText()));
    }

    private static void stateRead(Aggregate source, JsonNode detail, Map<String, Aggregate> states, String kindField, String path) {
        Aggregate state = state(source, detail, states);
        if (state == null) throw invalid(source, path + ".stateKey", "目标内部状态不存在");
        String type = state.data().path("stateType").asText();
        String kind = detail.path(kindField).asText();
        boolean valid = switch (kind) {
            case "VALUE", "VALUE_CHANGED" -> Set.of("COUNTER", "AMMO").contains(type);
            case "OPTION_SELECTED" -> "MODE".equals(type);
            case "ENABLED", "FLAG_CHANGED" -> "FLAG".equals(type);
            case "REMAINING_MS", "COOLDOWN_READY" -> "INTERNAL_COOLDOWN".equals(type);
            default -> false;
        };
        if (!valid) throw invalid(source, path + "." + kindField, "读取或事件种类与目标内部状态不匹配");
        if ("OPTION_SELECTED".equals(kind) && detail.hasNonNull("optionKey")) option(source, detail, state, path);
    }

    private static void operation(Aggregate source, JsonNode operation, Aggregate state, String path) {
        String type = state.data().path("stateType").asText();
        String kind = operation.path("operation").asText();
        boolean valid = switch (kind) {
            case "SET", "INCREASE", "DECREASE", "CONSUME" -> Set.of("COUNTER", "AMMO").contains(type);
            case "SELECT" -> "MODE".equals(type);
            case "ENABLE", "DISABLE", "TOGGLE" -> "FLAG".equals(type);
            case "START" -> "INTERNAL_COOLDOWN".equals(type);
            case "RESET" -> Set.of("COUNTER", "AMMO", "INTERNAL_COOLDOWN").contains(type);
            default -> false;
        };
        if (!valid) throw invalid(source, path + ".operation", "操作与目标内部状态种类不匹配");
        if ("SELECT".equals(kind)) option(source, operation, state, path);
    }

    private static void option(Aggregate source, JsonNode detail, Aggregate state, String path) {
        int matches = 0;
        for (JsonNode option : state.data().path("detail").path("options"))
            if (detail.path("optionKey").asText().equals(option.path("optionKey").asText())) matches++;
        if (matches != 1) throw invalid(source, path + ".optionKey", "模式选项不存在或无法唯一定位");
    }

    private static String owner(Aggregate source, JsonNode detail, String field) {
        // 已保存且本次未改写的旧引用仍使用原所属技能；新增/修改来源由提取器强制要求显式键。
        String value = detail.path(field).textValue();
        return value == null ? source.skillKey() : value;
    }

    private static String id(String skill, String key) { return skill + "/" + key; }

    private static ApiException invalid(Aggregate source, String field, String message) {
        return new ApiException(HttpStatus.CONFLICT, "409.SKILL_OBJECT_REFERENCE_INVALID", message,
            Map.of("fieldIssues", List.of(Map.of("field", field, "code", "REFERENCE_TYPE_MISMATCH", "message", message,
                "sourceSkillKey", source.skillKey(), "sourceType", source.type().name(), "sourceKey", source.key()))));
    }
}
