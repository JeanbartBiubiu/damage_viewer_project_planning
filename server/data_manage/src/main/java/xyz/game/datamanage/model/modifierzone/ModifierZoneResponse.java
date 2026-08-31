package xyz.game.datamanage.model.modifierzone;

import java.time.OffsetDateTime;

public record ModifierZoneResponse(
    String gameId,
    String modifierZoneKey,
    String name,
    ModifierZoneDomain domain,
    ModifierZoneCalculationMode calculationMode,
    ModifierZoneApplicationStage applicationStage,
    String description,
    ModifierZoneStatus status,
    Integer sortOrder,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
}
