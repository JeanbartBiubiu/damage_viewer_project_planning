package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.LinkedHashSet;
import java.util.Set;

/** 成功终结且绑定命中已结算的真实过程，始终明确所属技能。 */
public record SkillTriggerProcessResolvedEventDetail(
    String sourceSkillKey,
    String processKey,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerEventDetail {
    public SkillTriggerProcessResolvedEventDetail {
        sourceSkillKey = trim(sourceSkillKey);
        processKey = trim(processKey);
        foreignFields = SkillTriggerDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerProcessResolvedEventDetail(String sourceSkillKey, String processKey) {
        this(sourceSkillKey, processKey, Set.of(), Set.of());
    }

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    static SkillTriggerProcessResolvedEventDetail fromJson(JsonNode node) {
        if (!node.isObject()) throw new IllegalArgumentException("过程已结算事件明细必须为对象");
        Set<String> foreign = new LinkedHashSet<>(), unknown = new LinkedHashSet<>();
        node.fieldNames().forEachRemaining(field -> {
            if (Set.of("sourceSkillKey", "processKey").contains(field)) return;
            if (Set.of("moment", "useKind", "castPhase", "effectKey", "resultKey").contains(field)) foreign.add(field);
            else unknown.add(field);
        });
        return new SkillTriggerProcessResolvedEventDetail(key(node, "sourceSkillKey"), key(node, "processKey"), foreign, unknown);
    }

    private static String key(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || value.isNull()) return null;
        if (!value.isTextual()) throw new IllegalArgumentException("过程和技能标识必须为字符串");
        return value.textValue();
    }

    private static String trim(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
