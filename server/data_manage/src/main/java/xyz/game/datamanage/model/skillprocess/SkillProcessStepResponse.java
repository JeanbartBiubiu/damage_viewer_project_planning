package xyz.game.datamanage.model.skillprocess;

public record SkillProcessStepResponse(
    String stepKey,
    String name,
    SkillProcessStepType stepType,
    String description,
    Integer sortOrder,
    SkillProcessStepDetail detail
) {
}
