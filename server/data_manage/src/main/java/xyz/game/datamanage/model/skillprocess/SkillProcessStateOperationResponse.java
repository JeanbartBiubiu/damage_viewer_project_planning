package xyz.game.datamanage.model.skillprocess;

public record SkillProcessStateOperationResponse(
    String operationKey,
    String name,
    String stateKey,
    SkillProcessStateOperationKind operation,
    String valueFormulaKey,
    String optionKey,
    SkillProcessMoment moment,
    Integer sortOrder
) {
}
