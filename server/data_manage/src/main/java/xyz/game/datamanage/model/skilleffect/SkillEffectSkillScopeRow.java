package xyz.game.datamanage.model.skilleffect;

public record SkillEffectSkillScopeRow(
    String gameId,
    String skillKey,
    String effectKey,
    String resultKey,
    SkillEffectSkillScopeMode mode
) {
}
