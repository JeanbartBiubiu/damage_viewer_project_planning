package xyz.game.datamanage.model.damagetype;

import java.util.List;

public record DamageTypeListResponse(List<DamageTypeResponse> items, int total) {
}
