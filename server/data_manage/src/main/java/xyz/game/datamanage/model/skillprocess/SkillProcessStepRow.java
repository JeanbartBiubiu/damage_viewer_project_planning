package xyz.game.datamanage.model.skillprocess;

public record SkillProcessStepRow(
    String gameId,
    String skillKey,
    String processKey,
    String stepKey,
    String name,
    SkillProcessStepType stepType,
    String description,
    Integer sortOrder
) {
}
