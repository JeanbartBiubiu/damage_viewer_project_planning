package xyz.game.datamanage.model.skillprocess;

public record SkillProcessDelayStepDetailRow(
    String gameId, String skillKey, String processKey, String stepKey, String delayFormulaKey
) {
}
