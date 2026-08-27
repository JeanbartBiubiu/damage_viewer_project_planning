package xyz.game.datamanage.model.skillparameter;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.Map;

public record SkillParameterResponse(
    String gameId,
    String skillKey,
    String parameterKey,
    String name,
    SkillParameterValueType valueType,
    SkillParameterValueMode valueMode,
    BigDecimal fixedValue,
    Map<String, BigDecimal> levelValues,
    String description,
    Integer sortOrder,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
}
