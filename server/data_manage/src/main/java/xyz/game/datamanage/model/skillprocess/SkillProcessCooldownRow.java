package xyz.game.datamanage.model.skillprocess;

public record SkillProcessCooldownRow(
    String gameId,
    String skillKey,
    String processKey,
    String durationFormulaKey,
    SkillProcessMomentType momentType,
    String stepKey
) {
}
