package xyz.game.datamanage.model.skillprocess;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import xyz.game.datamanage.model.value.SkillNumericValue;

public record SkillProcessCooldown(
    @NotNull(message = "冷却时长不能为空")
    @Valid
    SkillNumericValue durationValue,
    @NotNull(message = "冷却开始时点不能为空")
    @Valid
    SkillProcessMoment startMoment
) {
    @JsonAnySetter
    public void rejectUnknownField(String fieldName, Object ignored) {
        throw new IllegalArgumentException("未知字段：" + fieldName);
    }
}
