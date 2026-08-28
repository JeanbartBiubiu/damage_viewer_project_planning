package xyz.game.datamanage.model.skillprocess;

public record SkillProcessEffectBindingRow(
    String gameId,
    String skillKey,
    String processKey,
    String bindingKey,
    String effectKey,
    SkillProcessMomentType momentType,
    String stepKey,
    Integer sortOrder
) {
}
