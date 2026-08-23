package xyz.game.datamanage.model.character;

import jakarta.validation.constraints.Size;

public record CharacterListQuery(
    @Size(max = 100, message = "关键词不能超过100个字符")
    String keyword
) {
    public CharacterListQuery {
        if (keyword != null) {
            keyword = keyword.trim();
            keyword = keyword.isEmpty() ? null : keyword;
        }
    }
}
