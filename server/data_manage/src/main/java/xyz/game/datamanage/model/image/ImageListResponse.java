package xyz.game.datamanage.model.image;

import java.util.List;

public record ImageListResponse(List<ImageResponse> items, int total) {
}
