package xyz.game.datamanage.model.skillcategory;

import java.util.List;

public record SkillCategoryListResponse(List<SkillCategoryResponse> items, int total) {
}
