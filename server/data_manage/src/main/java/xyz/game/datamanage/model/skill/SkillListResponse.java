package xyz.game.datamanage.model.skill;

import java.util.List;

public record SkillListResponse(List<SkillResponse> items, int total) {
}
