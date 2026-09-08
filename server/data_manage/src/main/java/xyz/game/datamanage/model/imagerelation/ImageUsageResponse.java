package xyz.game.datamanage.model.imagerelation;

import java.util.List;

public record ImageUsageResponse(
    String imageKey,
    List<Game> games,
    List<Character> characters,
    List<Attribute> attributes,
    List<Equipment> equipment,
    List<Skill> skills,
    List<SkillEffect> skillEffects,
    List<Status> statuses,
    List<Rune> runes,
    List<RunePath> runePaths
) {
    public record Game(String gameId, String gameName) {}
    public record Character(String characterKey, String characterName) {}
    public record Attribute(String attributeKey, String attributeName, String attributeStatus) {}
    public record Equipment(String equipmentKey, String equipmentName) {}
    public record Skill(String skillKey, String skillName, String skillStatus) {}
    public record SkillEffect(String skillKey, String skillName, String effectKey, String effectName) {}
    public record Status(String statusKey, String statusName, String statusStatus) {}
    public record Rune(String runeKey, String runeName) {}
    public record RunePath(String pathKey, String pathName) {}
}
