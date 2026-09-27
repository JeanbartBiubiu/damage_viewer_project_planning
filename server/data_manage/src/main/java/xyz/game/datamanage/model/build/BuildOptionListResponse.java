package xyz.game.datamanage.model.build;

import java.util.List;

public record BuildOptionListResponse(List<BuildOptionResponse> items, int total) {}
