package xyz.game.datamanage.model.skilleffect;

public record SkillEffectCriticalPolicy(
    SkillEffectCriticalMode mode,
    String multiplierFormulaKey
) {
    public SkillEffectCriticalPolicy {
        multiplierFormulaKey = multiplierFormulaKey == null ? null : multiplierFormulaKey.trim();
        if (multiplierFormulaKey != null && multiplierFormulaKey.isEmpty()) {
            multiplierFormulaKey = null;
        }
    }
}
