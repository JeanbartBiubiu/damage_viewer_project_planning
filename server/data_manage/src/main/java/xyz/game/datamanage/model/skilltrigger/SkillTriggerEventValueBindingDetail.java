package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.LinkedHashSet;
import java.util.Set;

public record SkillTriggerEventValueBindingDetail(
    SkillTriggerEventValueKey eventValueKey,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerRuntimeInputBindingDetail {

    public SkillTriggerEventValueBindingDetail {
        foreignFields = SkillTriggerDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerEventValueBindingDetail(SkillTriggerEventValueKey eventValueKey) {
        this(eventValueKey, Set.of(), Set.of());
    }

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    static SkillTriggerEventValueBindingDetail fromJson(JsonNode node) {
        if (!node.isObject()) throw new IllegalArgumentException("事件值绑定明细必须为对象");
        Set<String> unknown = new LinkedHashSet<>();
        node.fieldNames().forEachRemaining(field -> {
            if (!"eventValueKey".equals(field) && !"sourceActionKey".equals(field)) unknown.add(field);
        });
        return new SkillTriggerEventValueBindingDetail(
            SkillTriggerEventValueKey.fromJson(node.get("eventValueKey")),
            SkillTriggerDetailFieldCapture.captureForeign("sourceActionKey", node.get("sourceActionKey")),
            unknown
        );
    }
}
