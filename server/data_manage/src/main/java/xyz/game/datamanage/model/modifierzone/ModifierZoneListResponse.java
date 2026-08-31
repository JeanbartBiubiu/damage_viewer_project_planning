package xyz.game.datamanage.model.modifierzone;

import java.util.List;

public record ModifierZoneListResponse(List<ModifierZoneResponse> items, int total) {
}
