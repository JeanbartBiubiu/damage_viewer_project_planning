package xyz.game.datamanage.model.skillformula;

import com.fasterxml.jackson.databind.JsonNode;

import java.time.OffsetDateTime;

public record SkillFormulaDetailResponse(
    String gameId,
    String skillKey,
    String formulaKey,
    String name,
    String description,
    Integer sortOrder,
    JsonNode expression,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
}
