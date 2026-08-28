package xyz.game.datamanage.model.skillprocess;

public record SkillProcessStateOperationRow(
    String gameId,
    String skillKey,
    String processKey,
    String operationKey,
    String name,
    String stateKey,
    SkillProcessStateOperationKind operation,
    String valueFormulaKey,
    String optionKey,
    SkillProcessMomentType momentType,
    String stepKey,
    Integer sortOrder
) {
}
