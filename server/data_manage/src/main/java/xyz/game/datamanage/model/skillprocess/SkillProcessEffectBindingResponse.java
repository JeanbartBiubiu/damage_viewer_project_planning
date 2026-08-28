package xyz.game.datamanage.model.skillprocess;

public record SkillProcessEffectBindingResponse(
    String bindingKey,
    String effectKey,
    SkillProcessMoment moment,
    Integer sortOrder
) {
}
