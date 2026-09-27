package xyz.game.datamanage.model.build;

import java.util.List;

public record BuildGroupListResponse(List<BuildGroupResponse> items, int total) {}
