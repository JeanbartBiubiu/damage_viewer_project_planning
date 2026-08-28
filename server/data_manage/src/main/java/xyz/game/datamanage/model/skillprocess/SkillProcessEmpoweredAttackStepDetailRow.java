package xyz.game.datamanage.model.skillprocess;

public record SkillProcessEmpoweredAttackStepDetailRow(
    String gameId,
    String skillKey,
    String processKey,
    String stepKey,
    String windowFormulaKey,
    SkillProcessEmpoweredConsumeMoment consumeMoment
) {
}
