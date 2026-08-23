package xyz.game.datamanage.model.equipment;

import jakarta.validation.constraints.Size;

public record EquipmentListQuery(
    @Size(max = 100, message = "关键词不能超过100个字符")
    String keyword
) {
    public EquipmentListQuery {
        if (keyword != null) {
            keyword = keyword.trim();
            keyword = keyword.isEmpty() ? null : keyword;
        }
    }
}
