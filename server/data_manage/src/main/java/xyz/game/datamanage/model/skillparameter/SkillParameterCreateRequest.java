package xyz.game.datamanage.model.skillparameter;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.Map;

public record SkillParameterCreateRequest(
    @NotBlank(message = "参数标识不能为空")
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "参数标识格式不合法")
    String parameterKey,
    @NotBlank(message = "参数名称不能为空")
    @Size(max = 100, message = "参数名称不能超过100个字符")
    String name,
    @NotNull(message = "值类型不能为空")
    SkillParameterValueType valueType,
    @NotNull(message = "取值方式不能为空")
    SkillParameterValueMode valueMode,
    BigDecimal fixedValue,
    Map<String, BigDecimal> levelValues,
    @Size(max = 2000, message = "说明不能超过2000个字符")
    String description,
    @NotNull(message = "排序不能为空")
    @PositiveOrZero(message = "排序不能小于0")
    Integer sortOrder
) {
    public SkillParameterCreateRequest {
        parameterKey = normalizeRequired(parameterKey);
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
