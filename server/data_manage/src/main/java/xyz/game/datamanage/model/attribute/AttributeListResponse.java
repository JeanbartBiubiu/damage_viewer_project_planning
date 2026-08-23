package xyz.game.datamanage.model.attribute;

import java.util.List;

public record AttributeListResponse(List<AttributeResponse> items, int total) {

    public AttributeListResponse {
        items = List.copyOf(items);
    }
}
