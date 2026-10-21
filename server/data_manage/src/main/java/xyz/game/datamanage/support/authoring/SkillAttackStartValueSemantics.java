package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventSource;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateLockRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSkillEventDetail;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

/** 攻击起始快照只读取同技能自身状态；自然普攻计数与原技能弹药路径分别核对。 */
public final class SkillAttackStartValueSemantics {
    private SkillAttackStartValueSemantics() {}

    public static boolean readAllowed(Aggregate source, JsonNode detail, Aggregate state, String path) {
        if (state == null || !path.startsWith("conditionGroups[") || !source.skillKey().equals(state.skillKey())) return false;
        JsonNode event = source.data().path("eventSource");
        return readAllowed(source.skillKey(), detail.path("stateSkillKey").asText(source.skillKey()),
            event.path("detail").path("sourceSkillKey").asText(source.skillKey()), event.path("eventType").asText(),
            state.data().path("stateType").asText(), state.data().path("scope").asText());
    }

    public static boolean readAllowed(String skillKey, SkillTriggerEventSource event, String stateSkillKey,
                                      SkillTriggerInternalStateLockRow state) {
        if (event == null || event.eventType() == null || state == null || state.stateType() == null) return false;
        String eventSourceSkillKey = event.detail() instanceof SkillTriggerSkillEventDetail detail ? detail.sourceSkillKey() : skillKey;
        return readAllowed(skillKey, stateSkillKey == null ? skillKey : stateSkillKey,
            eventSourceSkillKey == null ? skillKey : eventSourceSkillKey, event.eventType().name(), state.stateType().name(), state.scope());
    }

    private static boolean readAllowed(String skillKey, String stateSkillKey, String eventSourceSkillKey,
                                       String eventType, String stateType, String scope) {
        if (!skillKey.equals(stateSkillKey) || !skillKey.equals(eventSourceSkillKey)) return false;
        return Set.of("BASIC_ATTACK_START", "BASIC_ATTACK_HIT").contains(eventType) && "COUNTER".equals(stateType)
                && "SKILL".equals(scope)
            || "SKILL_HIT".equals(eventType) && "AMMO".equals(stateType);
    }

    public static void validate(List<Aggregate> sources, List<Aggregate> context) {
        Map<String, Aggregate> states = new LinkedHashMap<>();
        for (Aggregate source : context) if (source.type() == SourceType.STATE) states.put(source.skillKey() + "/" + source.key(), source);
        List<Map<String, String>> issues = new ArrayList<>();
        for (Aggregate source : sources) {
            if (source.type() != SourceType.TRIGGER) continue;
            int groupIndex = 0;
            for (JsonNode group : source.data().path("conditionGroups")) {
                int conditionIndex = 0;
                for (JsonNode condition : group.path("conditions")) {
                    JsonNode detail = condition.path("detail");
                    if ("INTERNAL_STATE_CHECK".equals(condition.path("conditionType").asText())
                        && "ATTACK_START_VALUE".equals(detail.path("valueKind").asText())) {
                        String path = "conditionGroups[" + groupIndex + "].conditions[" + conditionIndex + "].detail";
                        Aggregate state = states.get(detail.path("stateSkillKey").asText(source.skillKey()) + "/" + detail.path("stateKey").asText());
                        if (!readAllowed(source, detail, state, path)) {
                            Map<String, String> row = new LinkedHashMap<>();
                            row.put("field", path + ".valueKind"); row.put("code", "ATTACK_START_VALUE_INVALID");
                            row.put("message", "攻击开始值只能读取同技能自身范围的自然普攻整数计数，或原技能命中的弹药");
                            row.put("sourceSkillKey", source.skillKey()); row.put("sourceType", source.type().name()); row.put("sourceKey", source.key());
                            issues.add(row);
                        }
                    }
                    conditionIndex++;
                }
                groupIndex++;
            }
        }
        if (!issues.isEmpty()) throw new ApiException(HttpStatus.CONFLICT, "409.SKILL_ATTACK_START_VALUE_INVALID",
            "攻击开始值与最终状态或事件不匹配", Map.of("fieldIssues", List.copyOf(issues)));
    }
}
