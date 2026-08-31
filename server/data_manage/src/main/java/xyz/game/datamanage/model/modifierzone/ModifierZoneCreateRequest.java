package xyz.game.datamanage.model.modifierzone;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

public record ModifierZoneCreateRequest(
    @NotBlank(message = "乘区标识不能为空")
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "乘区标识格式不合法")
    String modifierZoneKey,
    @NotBlank(message = "乘区名称不能为空")
    @Size(max = 100, message = "乘区名称不能超过100个字符")
    String name,
    @NotNull(message = "作用域不能为空")
    ModifierZoneDomain domain,
    @NotNull(message = "计算方式不能为空")
    ModifierZoneCalculationMode calculationMode,
    @NotNull(message = "应用阶段不能为空")
    ModifierZoneApplicationStage applicationStage,
    @Size(max = 2000, message = "说明不能超过2000个字符")
    String description,
    @NotNull(message = "状态不能为空")
    ModifierZoneStatus status,
    @NotNull(message = "排序不能为空")
    @PositiveOrZero(message = "排序不能小于0")
    Integer sortOrder
) {
    public ModifierZoneCreateRequest {
        modifierZoneKey = normalizeRequired(modifierZoneKey);
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
