package xyz.game.datamanage.model.rune;

import java.util.List;

public record RunePathListResponse(List<RunePathResponse> items, int total) {}
