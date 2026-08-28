package xyz.game.datamanage.model.skilleffect;

public record SkillEffectResultResponse(
    String resultKey,
    String name,
    SkillEffectResultType resultType,
    SkillEffectTarget target,
    String description,
    Integer sortOrder,
    SkillEffectValueRuleResponse valueRule,
    SkillEffectResultDetail detail
) {
}
