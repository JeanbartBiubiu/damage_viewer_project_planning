package xyz.game.datamanage.model.skillformula;

import java.time.OffsetDateTime;

public record SkillFormulaRow(
    String gameId,
    String skillKey,
    String formulaKey,
    String name,
    String description,
    Integer sortOrder,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
}
