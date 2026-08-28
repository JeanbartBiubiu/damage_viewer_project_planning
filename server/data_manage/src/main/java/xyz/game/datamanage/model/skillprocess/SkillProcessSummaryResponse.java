package xyz.game.datamanage.model.skillprocess;

import java.time.OffsetDateTime;

public record SkillProcessSummaryResponse(
    String gameId,
    String skillKey,
    String processKey,
    String name,
    SkillProcessActivationType activationType,
    String description,
    Integer sortOrder,
    Integer stepCount,
    Integer effectBindingCount,
    Integer stateOperationCount,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
}
