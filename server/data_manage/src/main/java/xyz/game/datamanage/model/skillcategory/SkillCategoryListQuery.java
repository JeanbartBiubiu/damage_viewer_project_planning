package xyz.game.datamanage.model.skillcategory;

import jakarta.validation.constraints.Size;

public record SkillCategoryListQuery(
    @Size(max = 100, message = "关键词不能超过100个字符")
    String keyword,
    String status
) {
    public SkillCategoryListQuery {
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
