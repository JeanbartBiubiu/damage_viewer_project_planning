package xyz.game.datamanage.model.skilltrigger;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record SkillTriggerProcessLimit(
    @NotBlank(message = "过程标识不能为空")
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "过程标识格式不合法")
    String processKey,
    @NotBlank(message = "次数公式不能为空")
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "次数公式标识格式不合法")
    String limitFormulaKey
) {
    public SkillTriggerProcessLimit {
        processKey = processKey == null ? null : processKey.trim();
        limitFormulaKey = limitFormulaKey == null ? null : limitFormulaKey.trim();
    }
}
