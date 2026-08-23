package xyz.game.datamanage.model.attribute;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

public record AttributeResponse(
    String gameId,
    String attributeKey,
    String name,
    AttributeValueType valueType,
    BigDecimal minValue,
    BigDecimal maxValue,
    String description,
    AttributeStatus status,
    Integer sortOrder,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
}
