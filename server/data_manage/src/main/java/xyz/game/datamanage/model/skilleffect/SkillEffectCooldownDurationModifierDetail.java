package xyz.game.datamanage.model.skilleffect;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/** 有期冷却时长倍率只保存明确技能范围，不复用急速或剩余冷却操作。 */
public record SkillEffectCooldownDurationModifierDetail(
    SkillEffectAffectedSkillScope affectedSkillScope
) implements SkillEffectResultDetail {
    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    static SkillEffectCooldownDurationModifierDetail fromJson(JsonNode detail) {
        if (!detail.isObject() || detail.size() != 1 || !detail.has("affectedSkillScope")) {
            throw new IllegalArgumentException("冷却时长修正明细只允许 affectedSkillScope");
        }
        JsonNode scope = detail.path("affectedSkillScope");
        if (!scope.isObject() || scope.size() != 3 || !scope.has("mode")
            || !scope.has("skillKeys") || !scope.has("skillCategoryKeys")
            || !scope.path("mode").isTextual() || !"SKILLS".equals(scope.path("mode").textValue())) {
            throw new IllegalArgumentException("冷却时长修正必须明确指定技能范围及完整列表");
        }
        return new SkillEffectCooldownDurationModifierDetail(new SkillEffectAffectedSkillScope(
            SkillEffectSkillScopeMode.SKILLS, strings(scope.path("skillKeys")), strings(scope.path("skillCategoryKeys"))));
    }

    private static List<String> strings(JsonNode values) {
        if (!values.isArray()) throw new IllegalArgumentException("技能范围列表必须是字符串数组");
        List<String> result = new ArrayList<>();
        for (JsonNode value : values) {
            if (!value.isTextual()) throw new IllegalArgumentException("技能范围列表只允许明确字符串");
            result.add(value.textValue());
        }
        return result;
    }

    @Override @JsonIgnore public Set<String> foreignFields() { return Set.of(); }
    @Override @JsonIgnore public Set<String> unknownFields() { return Set.of(); }
}
