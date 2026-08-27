package xyz.game.datamanage.model.skillformula;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

public record SkillFormulaCreateRequest(
    @NotBlank(message = "公式标识不能为空")
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "公式标识格式不合法")
    String formulaKey,
    @NotBlank(message = "公式名称不能为空")
    @Size(max = 100, message = "公式名称不能超过100个字符")
    String name,
    @Size(max = 2000, message = "说明不能超过2000个字符")
    String description,
    @NotNull(message = "排序不能为空")
    @PositiveOrZero(message = "排序不能小于0")
    Integer sortOrder,
    @NotNull(message = "公式表达式不能为空")
    SkillFormulaExpressionNode expression
) {
    public SkillFormulaCreateRequest {
        formulaKey = normalizeRequired(formulaKey);
        name = normalizeRequired(name);
        description = normalizeOptional(description);
    }

    private static String normalizeRequired(String value) {
        return value == null ? null : value.trim();
    }

    private static String normalizeOptional(String value) {
        if (value == null) {
            return null;
        }
        String normalized = value.trim();
        return normalized.isEmpty() ? null : normalized;
    }
}
