package xyz.game.datamanage.model.status;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

public record StatusCreateRequest(
    @NotBlank(message = "状态标识不能为空")
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "状态标识格式不合法")
    String statusKey,
    @NotBlank(message = "状态名称不能为空")
    @Size(max = 100, message = "状态名称不能超过100个字符")
    String name,
    @Size(max = 2000, message = "说明不能超过2000个字符")
    String description,
    @NotNull(message = "状态种类不能为空")
    StatusKind statusKind,
    @NotNull(message = "状态不能为空")
    StatusRecordStatus status,
    @NotNull(message = "排序不能为空")
    @PositiveOrZero(message = "排序不能小于0")
    Integer sortOrder
) {
    public StatusCreateRequest {
        statusKey = normalizeRequired(statusKey);
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
