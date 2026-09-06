package xyz.game.datamanage.model.skillrelation;

import java.util.List;

public record EquipmentSkillRelationListResponse(List<EquipmentSkillRelationResponse> items, long total) {
}
