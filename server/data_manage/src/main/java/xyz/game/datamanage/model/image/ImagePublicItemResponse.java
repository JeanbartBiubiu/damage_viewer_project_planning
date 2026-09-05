package xyz.game.datamanage.model.image;

import java.time.OffsetDateTime;

public record ImagePublicItemResponse(
    String imageKey,
    Boolean enabled,
    String imageBase64,
    OffsetDateTime updatedAt
) {
}
