package xyz.game.datamanage.model.skillrelation;

import java.util.List;

public record RuneSkillRelationListResponse(List<RuneSkillRelationResponse> items, long total) {
}
