package xyz.game.datamanage.model.damagetype;

import java.time.OffsetDateTime;
import com.fasterxml.jackson.databind.JsonNode;

public record DamageTypeFormulaResponse(
    String gameId,
    String damageTypeKey,
    JsonNode formula,
    OffsetDateTime updatedAt
) {
}
