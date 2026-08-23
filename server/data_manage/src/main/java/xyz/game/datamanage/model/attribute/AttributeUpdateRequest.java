package xyz.game.datamanage.model.attribute;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Null;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;

public record AttributeUpdateRequest(
    @Null(message = "稳定标识不能在修改时传入")
    String attributeKey,
    @NotBlank(message = "名称不能为空")
    @Size(max = 100, message = "名称不能超过100个字符")
    String name,
    @NotNull(message = "数值类型不能为空")
    AttributeValueType valueType,
    BigDecimal minValue,
    BigDecimal maxValue,
    @Size(max = 2000, message = "描述不能超过2000个字符")
    String description,
    @NotNull(message = "状态不能为空")
    AttributeStatus status,
    @NotNull(message = "排序不能为空")
    @PositiveOrZero(message = "排序不能小于0")
    Integer sortOrder
) {
    public AttributeUpdateRequest {
        name = normalizeRequiredText(name);
        description = normalizeOptionalText(description);
    }

    private static String normalizeRequiredText(String value) {
        return value == null ? null : value.trim();
    }

    private static String normalizeOptionalText(String value) {
        if (value == null) {
            return null;
        }
        String normalized = value.trim();
        return normalized.isEmpty() ? null : normalized;
    }
}
