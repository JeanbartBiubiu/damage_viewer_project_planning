package xyz.game.datamanage.model.skilleffect;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public record SkillEffectAffectedSkillScope(
    SkillEffectSkillScopeMode mode,
    List<String> skillKeys,
    List<String> skillCategoryKeys
) {

    public SkillEffectAffectedSkillScope {
        if (skillKeys != null) {
            List<String> normalized = new ArrayList<>(skillKeys.size());
            for (String skillKey : skillKeys) {
                normalized.add(skillKey == null ? null : skillKey.trim());
            }
            skillKeys = Collections.unmodifiableList(normalized);
        }
        if (skillCategoryKeys != null) {
            List<String> normalized = new ArrayList<>(skillCategoryKeys.size());
            for (String skillCategoryKey : skillCategoryKeys) {
                normalized.add(skillCategoryKey == null ? null : skillCategoryKey.trim());
            }
            skillCategoryKeys = Collections.unmodifiableList(normalized);
        }
    }

    @JsonCreator
    static SkillEffectAffectedSkillScope fromJson(
        @JsonProperty("mode") SkillEffectSkillScopeMode mode,
        @JsonProperty("skillKeys") List<String> skillKeys,
        @JsonProperty("skillCategoryKeys") List<String> skillCategoryKeys
    ) {
        return new SkillEffectAffectedSkillScope(mode, skillKeys, skillCategoryKeys);
    }
}
