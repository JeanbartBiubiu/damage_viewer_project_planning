package xyz.game.datamanage.model.image;

import java.time.OffsetDateTime;

public record ImageListItemResponse(
    String gameId,
    String imageKey,
    String name,
    String description,
    String mimeType,
    Integer byteSize,
    Integer width,
    Integer height,
    Boolean enabled,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {}
