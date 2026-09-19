package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.LinkedHashSet;
import java.util.Set;

public record SkillTriggerSkillHitTargetIsEnemyConditionDetail(
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerConditionDetail {

    public SkillTriggerSkillHitTargetIsEnemyConditionDetail {
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerSkillHitTargetIsEnemyConditionDetail() {
        this(Set.of());
    }

    @Override
    @JsonIgnore
    public Set<String> foreignFields() {
        return Set.of();
    }

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    static SkillTriggerSkillHitTargetIsEnemyConditionDetail fromJson(JsonNode node) {
        if (!node.isObject()) {
            throw new IllegalArgumentException("技能命中敌方对象条件明细必须为空对象");
        }
        Set<String> unknown = new LinkedHashSet<>();
        node.fieldNames().forEachRemaining(unknown::add);
        return new SkillTriggerSkillHitTargetIsEnemyConditionDetail(unknown);
    }
}
