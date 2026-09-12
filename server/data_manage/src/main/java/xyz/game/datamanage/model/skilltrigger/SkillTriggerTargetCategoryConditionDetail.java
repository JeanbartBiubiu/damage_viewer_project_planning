package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

public record SkillTriggerTargetCategoryConditionDetail(
    List<SkillTriggerTargetCategory> categories,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerConditionDetail {
    public SkillTriggerTargetCategoryConditionDetail {
        categories = categories == null ? null : Collections.unmodifiableList(new ArrayList<>(categories));
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerTargetCategoryConditionDetail(List<SkillTriggerTargetCategory> categories) {
        this(categories, Set.of());
    }

    @Override @JsonIgnore public Set<String> foreignFields() { return Set.of(); }

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    static SkillTriggerTargetCategoryConditionDetail fromJson(JsonNode node) {
        if (!node.isObject()) throw new IllegalArgumentException("事件对方类别明细必须为对象");
        JsonNode categories = node.get("categories");
        List<SkillTriggerTargetCategory> selected = null;
        if (categories != null && !categories.isNull()) {
            if (!categories.isArray()) throw new IllegalArgumentException("事件对方类别必须为数组");
            selected = new ArrayList<>();
            for (JsonNode category : categories) {
                if (!category.isTextual()) throw new IllegalArgumentException("事件对方类别必须为明确的类别标识");
                selected.add(SkillTriggerTargetCategory.valueOf(category.textValue()));
            }
        }
        Set<String> unknown = new LinkedHashSet<>();
        node.fieldNames().forEachRemaining(field -> { if (!"categories".equals(field)) unknown.add(field); });
        return new SkillTriggerTargetCategoryConditionDetail(selected, unknown);
    }
}
