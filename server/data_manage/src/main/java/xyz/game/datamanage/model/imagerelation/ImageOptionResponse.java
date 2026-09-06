package xyz.game.datamanage.model.imagerelation;

import java.util.List;

public record ImageOptionResponse(List<Item> items, int total) {
    public record Item(String imageKey, String name) {}
}
