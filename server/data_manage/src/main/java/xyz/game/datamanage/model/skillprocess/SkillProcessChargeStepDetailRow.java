package xyz.game.datamanage.model.skillprocess;

public record SkillProcessChargeStepDetailRow(
    String gameId,
    String skillKey,
    String processKey,
    String stepKey,
    String minimumChargeFormulaKey,
    String maximumChargeFormulaKey,
    Boolean releaseAtMaximum
) {
}
