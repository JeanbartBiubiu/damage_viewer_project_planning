package xyz.game.datamanage.model.skillprocess;

import xyz.game.datamanage.model.value.SkillNumericValue;

public record SkillProcessStateOperationResponse(
    String operationKey,
    String name,
    String stateKey,
    SkillProcessStateOperationKind operation,
    SkillNumericValue value,
    String optionKey,
    SkillProcessMoment moment,
    Integer sortOrder
) {
}
