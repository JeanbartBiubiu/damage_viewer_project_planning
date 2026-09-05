package xyz.game.datamanage.model.image;

import java.util.List;

public record ImagePublicListResponse(
    String gameId,
    List<ImagePublicItemResponse> images
) {
}
