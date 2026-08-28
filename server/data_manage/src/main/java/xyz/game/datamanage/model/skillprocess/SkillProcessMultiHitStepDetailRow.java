package xyz.game.datamanage.model.skillprocess;

public record SkillProcessMultiHitStepDetailRow(
    String gameId,
    String skillKey,
    String processKey,
    String stepKey,
    String repeatCountFormulaKey,
    String intervalFormulaKey
) {
}
