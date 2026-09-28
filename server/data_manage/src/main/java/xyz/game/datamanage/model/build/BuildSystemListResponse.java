package xyz.game.datamanage.model.build;

import java.util.List;

public record BuildSystemListResponse(List<BuildSystemResponse> items, int total) {}
