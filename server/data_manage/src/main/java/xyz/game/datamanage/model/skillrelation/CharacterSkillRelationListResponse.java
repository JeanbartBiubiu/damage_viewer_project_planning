package xyz.game.datamanage.model.skillrelation;

import java.util.List;

public record CharacterSkillRelationListResponse(List<CharacterSkillRelationResponse> items, long total) {
}
