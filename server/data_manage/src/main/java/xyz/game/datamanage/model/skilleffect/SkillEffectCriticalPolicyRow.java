package xyz.game.datamanage.model.skilleffect;

public record SkillEffectCriticalPolicyRow(
    String gameId,
    String skillKey,
    String effectKey,
    String resultKey,
    SkillEffectCriticalMode criticalMode,
    String multiplierFormulaKey
) {
}
