package xyz.game.datamanage.model.skillrelation;

import xyz.game.datamanage.model.skill.SkillStatus;

public record RuneSkillRelationResponse(
    String gameId,
    String runeKey,
    String runeName,
    String skillKey,
    String skillName,
    SkillStatus skillStatus,
    Integer sortOrder
) {
}
