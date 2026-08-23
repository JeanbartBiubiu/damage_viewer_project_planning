package xyz.game.datamanage.model.equipment;

import java.util.List;

public record EquipmentListResponse(List<EquipmentResponse> items, int total) {
}
