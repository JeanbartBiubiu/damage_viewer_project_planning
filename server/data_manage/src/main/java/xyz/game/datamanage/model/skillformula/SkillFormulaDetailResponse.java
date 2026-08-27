package xyz.game.datamanage.model.skillformula;

import java.time.OffsetDateTime;

public record SkillFormulaDetailResponse(
    String gameId,
    String skillKey,
    String formulaKey,
    String name,
    String description,
    Integer sortOrder,
    SkillFormulaExpressionNode expression,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
}
