package xyz.game.datamanage.model.damagetype;

/** 伤害类型结算公式的五个阶段，声明顺序就是允许引用的前序。 */
public enum DamageTypeFormulaStage {
    RESISTANCE_BEFORE_PENETRATION,
    PENETRATION_PERCENT,
    PENETRATION_FLAT,
    EFFECTIVE_RESISTANCE,
    RESISTANCE_FACTOR;

    public boolean allows(DamageTypeFormulaStage referenced) {
        return referenced != null && referenced.ordinal() < ordinal();
    }

    public static DamageTypeFormulaStage fromText(String value) {
        if (value == null) {
            return null;
        }
        try {
            return valueOf(value);
        } catch (IllegalArgumentException ex) {
            return null;
        }
    }
}
