package xyz.game.datamanage.model.damagetype;

import java.time.OffsetDateTime;

public record DamageTypeFormulaRow(
    String gameId,
    String damageTypeKey,
    String calculationFormula,
    OffsetDateTime updatedAt
) {
}
