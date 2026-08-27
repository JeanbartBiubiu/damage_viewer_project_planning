package xyz.game.datamanage.model.status;

import java.util.List;

public record StatusListResponse(List<StatusResponse> items, int total) {
}
