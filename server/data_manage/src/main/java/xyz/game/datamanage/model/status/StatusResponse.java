package xyz.game.datamanage.model.status;

import java.time.OffsetDateTime;

public record StatusResponse(
    String gameId,
    String statusKey,
    String name,
    String description,
    StatusKind statusKind,
    StatusRecordStatus status,
    Integer sortOrder,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
}
