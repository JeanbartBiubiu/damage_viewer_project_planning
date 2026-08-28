package xyz.game.datamanage.model.skillprocess;

public record SkillProcessRecastStepDetailRow(
    String gameId,
    String skillKey,
    String processKey,
    String stepKey,
    String windowFormulaKey,
    String maximumRecastCountFormulaKey
) {
}
