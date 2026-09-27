package xyz.game.datamanage.model.damagetype;

public record DamageTypeCalculationFormula(
    DamageTypeFormulaNode resistanceBeforePenetration,
    DamageTypeFormulaNode penetrationPercent,
    DamageTypeFormulaNode penetrationFlat,
    DamageTypeFormulaNode effectiveResistance,
    DamageTypeFormulaNode resistanceFactor
) {
}
