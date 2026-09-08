package xyz.game.datamanage.model.rune;

import java.util.List;

public record RuneListResponse(List<RuneResponse> items, int total) {}
