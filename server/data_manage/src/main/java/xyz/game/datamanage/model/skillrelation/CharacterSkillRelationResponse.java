package xyz.game.datamanage.model.skillrelation;

import xyz.game.datamanage.model.skill.SkillStatus;

public record CharacterSkillRelationResponse(
    String gameId,
    String characterKey,
    String characterName,
    String skillKey,
    String skillName,
    SkillStatus skillStatus,
    Integer sortOrder
) {
}
