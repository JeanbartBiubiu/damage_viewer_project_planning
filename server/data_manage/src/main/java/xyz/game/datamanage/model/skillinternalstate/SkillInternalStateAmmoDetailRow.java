package xyz.game.datamanage.model.skillinternalstate;

public record SkillInternalStateAmmoDetailRow(
    String gameId,
    String skillKey,
    String stateKey,
    String initialValueFormulaKey,
    String maxValueFormulaKey,
    String recoveryIntervalFormulaKey,
    SkillInternalStateAmmoRecoveryMode recoveryMode
) {
}
