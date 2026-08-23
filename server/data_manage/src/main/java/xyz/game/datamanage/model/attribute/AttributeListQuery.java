package xyz.game.datamanage.model.attribute;

import jakarta.validation.constraints.Size;

public record AttributeListQuery(
    @Size(max = 100, message = "关键词不能超过100个字符")
    String keyword,
    String status
) {
    public AttributeListQuery {
        keyword = normalizeOptionalText(keyword);
        status = normalizeOptionalText(status);
    }

    private static String normalizeOptionalText(String value) {
        if (value == null) {
            return null;
        }
        String normalized = value.trim();
        return normalized.isEmpty() ? null : normalized;
    }
}
