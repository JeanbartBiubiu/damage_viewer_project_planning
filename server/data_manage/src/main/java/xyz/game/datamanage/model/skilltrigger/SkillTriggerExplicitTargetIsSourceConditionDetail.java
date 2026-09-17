package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.LinkedHashSet;
import java.util.Set;

public record SkillTriggerExplicitTargetIsSourceConditionDetail(
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerConditionDetail {

    public SkillTriggerExplicitTargetIsSourceConditionDetail {
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerExplicitTargetIsSourceConditionDetail() {
        this(Set.of());
    }

    @Override
    @JsonIgnore
    public Set<String> foreignFields() {
        return Set.of();
    }

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    static SkillTriggerExplicitTargetIsSourceConditionDetail fromJson(JsonNode node) {
        if (!node.isObject()) {
            throw new IllegalArgumentException("显式自施目标条件明细必须为空对象");
        }
        Set<String> unknown = new LinkedHashSet<>();
        node.fieldNames().forEachRemaining(unknown::add);
        return new SkillTriggerExplicitTargetIsSourceConditionDetail(unknown);
    }
}
