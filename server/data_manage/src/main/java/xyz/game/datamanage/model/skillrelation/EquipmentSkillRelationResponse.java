package xyz.game.datamanage.model.skillrelation;

import xyz.game.datamanage.model.skill.SkillStatus;

public record EquipmentSkillRelationResponse(
    String gameId,
    String equipmentKey,
    String equipmentName,
    String skillKey,
    String skillName,
    SkillStatus skillStatus,
    Integer sortOrder
) {
}
