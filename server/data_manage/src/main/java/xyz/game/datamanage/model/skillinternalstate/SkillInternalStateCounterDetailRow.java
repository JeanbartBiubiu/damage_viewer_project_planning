package xyz.game.datamanage.model.skillinternalstate;

public record SkillInternalStateCounterDetailRow(
    String gameId,
    String skillKey,
    String stateKey,
    String initialValueFormulaKey,
    String maxValueFormulaKey
) {
}
