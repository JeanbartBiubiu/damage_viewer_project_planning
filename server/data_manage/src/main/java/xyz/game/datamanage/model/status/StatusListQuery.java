package xyz.game.datamanage.model.status;

import jakarta.validation.constraints.Size;

public record StatusListQuery(
    @Size(max = 100, message = "关键词不能超过100个字符")
    String keyword,
    String status
) {
    public StatusListQuery {
        keyword = normalize(keyword);
        status = normalize(status);
    }

    private static String normalize(String value) {
        if (value == null) {
            return null;
        }
        String normalized = value.trim();
        return normalized.isEmpty() ? null : normalized;
    }
}
