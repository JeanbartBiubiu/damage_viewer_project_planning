package xyz.game.datamanage.model.skillprocess;

public record SkillProcessPeriodicStepDetailRow(
    String gameId,
    String skillKey,
    String processKey,
    String stepKey,
    String repeatCountFormulaKey,
    String intervalFormulaKey,
    SkillProcessFirstExecution firstExecution
) {
}
