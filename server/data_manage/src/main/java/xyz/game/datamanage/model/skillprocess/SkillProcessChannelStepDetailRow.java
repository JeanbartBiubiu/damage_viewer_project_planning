package xyz.game.datamanage.model.skillprocess;

public record SkillProcessChannelStepDetailRow(
    String gameId,
    String skillKey,
    String processKey,
    String stepKey,
    String durationFormulaKey,
    String executionCountFormulaKey,
    SkillProcessFirstExecution firstExecution
) {
}
