package xyz.game.datamanage.model.image;

import java.util.List;

public record ImageListResponse(List<ImageListItemResponse> items, int total) {
}
