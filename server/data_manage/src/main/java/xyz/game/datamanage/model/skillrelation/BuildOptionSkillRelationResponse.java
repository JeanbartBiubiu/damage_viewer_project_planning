package xyz.game.datamanage.model.skillrelation;

import xyz.game.datamanage.model.skill.SkillStatus;

public record BuildOptionSkillRelationResponse(
    String gameId,
    String systemKey,
    String optionKey,
    String optionName,
    String skillKey,
    String skillName,
    SkillStatus skillStatus,
    Integer activationRank,
    String skillLevelMode,
    Integer fixedSkillLevel,
    Integer sortOrder
) {}
