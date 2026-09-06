package xyz.game.datamanage.model.skilleffect;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.Valid;
import xyz.game.datamanage.model.value.SkillNumericValue;

public record SkillEffectCriticalPolicy(
    SkillEffectCriticalMode mode,
    @Valid
    SkillNumericValue multiplierValue
) {
    @JsonAnySetter
    public void rejectUnknownField(String fieldName, Object ignored) {
        throw new IllegalArgumentException("未知字段：" + fieldName);
    }
}
