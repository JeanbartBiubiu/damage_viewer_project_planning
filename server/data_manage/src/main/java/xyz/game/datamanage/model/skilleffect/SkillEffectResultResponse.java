package xyz.game.datamanage.model.skilleffect;

public record SkillEffectResultResponse(
    String resultKey,
    String name,
    SkillEffectResultType resultType,
    SkillEffectTarget target,
    String description,
    Integer sortOrder,
    SkillEffectValueRuleResponse valueRule,
    SkillEffectResultDetail detail,
    SkillEffectResultLifecycleBehaviorResponse lifecycleBehavior,
    SkillEffectSpellShieldBlockScope spellShieldBlockScope
) {
    public SkillEffectResultResponse(
        String resultKey,
        String name,
        SkillEffectResultType resultType,
        SkillEffectTarget target,
        String description,
        Integer sortOrder,
        SkillEffectValueRuleResponse valueRule,
        SkillEffectResultDetail detail,
        SkillEffectResultLifecycleBehaviorResponse lifecycleBehavior
    ) {
        this(
            resultKey,
            name,
            resultType,
            target,
            description,
            sortOrder,
            valueRule,
            detail,
            lifecycleBehavior,
            null
        );
    }

    public SkillEffectResultResponse(
        String resultKey,
        String name,
        SkillEffectResultType resultType,
        SkillEffectTarget target,
        String description,
        Integer sortOrder,
        SkillEffectValueRuleResponse valueRule,
        SkillEffectResultDetail detail
    ) {
        this(resultKey, name, resultType, target, description, sortOrder, valueRule, detail, null, null);
    }
}
