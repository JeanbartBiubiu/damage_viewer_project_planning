package xyz.game.datamanage.model.image;

import java.time.OffsetDateTime;

public record ImageResponse(
    String gameId,
    String imageKey,
    String name,
    String description,
    String imageBase64,
    String mimeType,
    Integer byteSize,
    Integer width,
    Integer height,
    Boolean enabled,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
}
