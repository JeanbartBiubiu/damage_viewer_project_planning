package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import xyz.game.datamanage.model.value.SkillNumericValue;

public record SkillTriggerPerTargetCooldown(
    @NotNull(message = "每目标冷却时长不能为空")
    @Valid
    SkillNumericValue durationValue,
    @NotNull(message = "每目标冷却目标对象不能为空")
    SkillTriggerTargetContext targetContext
) {
    @JsonAnySetter
    public void rejectUnknownField(String fieldName, Object ignored) {
        throw new IllegalArgumentException("未知字段：" + fieldName);
    }
}
