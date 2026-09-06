package xyz.game.datamanage.model.skillprocess;

import xyz.game.datamanage.model.value.SkillNumericValue;

public record SkillProcessStateOperationRow(
    String gameId,
    String skillKey,
    String processKey,
    String operationKey,
    String name,
    String stateKey,
    SkillProcessStateOperationKind operation,
    SkillNumericValue value,
    String optionKey,
    SkillProcessMomentType momentType,
    String stepKey,
    Integer sortOrder
) {
}
