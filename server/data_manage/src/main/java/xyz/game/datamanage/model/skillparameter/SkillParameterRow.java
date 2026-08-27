package xyz.game.datamanage.model.skillparameter;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

public record SkillParameterRow(
    String gameId,
    String skillKey,
    String parameterKey,
    String name,
    SkillParameterValueType valueType,
    SkillParameterValueMode valueMode,
    BigDecimal fixedValue,
    String levelValuesJson,
    String description,
    Integer sortOrder,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
}
