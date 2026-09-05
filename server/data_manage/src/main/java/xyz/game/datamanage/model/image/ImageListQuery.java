package xyz.game.datamanage.model.image;

import jakarta.validation.constraints.Size;

public record ImageListQuery(
    @Size(max = 100, message = "关键词不能超过100个字符")
    String keyword,
    Boolean enabled
) {

    public ImageListQuery {
        if (keyword != null) {
            keyword = keyword.trim();
            keyword = keyword.isEmpty() ? null : keyword;
        }
    }
}
