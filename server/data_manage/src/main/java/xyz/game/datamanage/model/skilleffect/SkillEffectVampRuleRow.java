package xyz.game.datamanage.model.skilleffect;

public record SkillEffectVampRuleRow(
    String gameId,
    String skillKey,
    String effectKey,
    String resultKey,
    SkillEffectVampType vampType,
    SkillEffectVampBasisOutputKind basisOutputKind,
    String efficiencyFormulaKey
) {
}
