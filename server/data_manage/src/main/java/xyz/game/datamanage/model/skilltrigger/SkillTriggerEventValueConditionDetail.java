package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import java.util.LinkedHashSet;
import java.util.Set;
import xyz.game.datamanage.model.value.SkillNumericValue;

public record SkillTriggerEventValueConditionDetail(
    SkillTriggerEventValueKey eventValueKey,
    SkillTriggerComparator comparator,
    @Valid
    SkillNumericValue comparisonValue,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerConditionDetail {

    public SkillTriggerEventValueConditionDetail {
        foreignFields = SkillTriggerDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerEventValueConditionDetail(
        SkillTriggerEventValueKey eventValueKey,
        SkillTriggerComparator comparator,
        SkillNumericValue comparisonValue
    ) {
        this(eventValueKey, comparator, comparisonValue, Set.of(), Set.of());
    }

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    static SkillTriggerEventValueConditionDetail fromJson(JsonNode node) {
        if (!node.isObject()) throw new IllegalArgumentException("事件值条件明细必须为对象");
        Set<String> unknown = new LinkedHashSet<>();
        node.fieldNames().forEachRemaining(field -> {
            if (!Set.of("eventValueKey", "comparator", "comparisonValue", "stateKey").contains(field)) unknown.add(field);
        });
        JsonNode comparatorNode = node.get("comparator");
        SkillTriggerComparator comparator = null;
        if (comparatorNode != null && !comparatorNode.isNull()) {
            if (!comparatorNode.isTextual()) throw new IllegalArgumentException("比较符必须为明确标识");
            comparator = SkillTriggerComparator.valueOf(comparatorNode.textValue());
        }
        return new SkillTriggerEventValueConditionDetail(
            SkillTriggerEventValueKey.fromJson(node.get("eventValueKey")),
            comparator,
            SkillNumericValue.fromJson(node.get("comparisonValue")),
            SkillTriggerDetailFieldCapture.captureForeign("stateKey", node.get("stateKey")),
            unknown
        );
    }
}
