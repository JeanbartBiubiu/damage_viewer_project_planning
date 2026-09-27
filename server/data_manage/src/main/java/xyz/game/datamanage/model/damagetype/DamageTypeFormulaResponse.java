package xyz.game.datamanage.model.damagetype;

import java.time.OffsetDateTime;

public record DamageTypeFormulaResponse(
    String gameId,
    String damageTypeKey,
    DamageTypeCalculationFormula formula,
    OffsetDateTime updatedAt
) {
}
