package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import xyz.game.datamanage.model.value.SkillNumericValue;

public record SkillTriggerProcessLimit(
    @NotBlank(message = "过程标识不能为空")
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "过程标识格式不合法")
    String processKey,
    @NotNull(message = "触发次数上限不能为空")
    @Valid
    SkillNumericValue limitValue
) {
    public SkillTriggerProcessLimit {
        processKey = processKey == null ? null : processKey.trim();
    }

    @JsonAnySetter
    public void rejectUnknownField(String fieldName, Object ignored) {
        throw new IllegalArgumentException("未知字段：" + fieldName);
    }
}
