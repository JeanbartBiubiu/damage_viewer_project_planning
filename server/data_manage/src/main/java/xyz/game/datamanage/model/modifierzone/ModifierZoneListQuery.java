package xyz.game.datamanage.model.modifierzone;

import jakarta.validation.constraints.Size;

public record ModifierZoneListQuery(
    @Size(max = 100, message = "关键词不能超过100个字符")
    String keyword,
    String domain,
    String status
) {
    public ModifierZoneListQuery {
        keyword = normalize(keyword);
        domain = normalize(domain);
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
