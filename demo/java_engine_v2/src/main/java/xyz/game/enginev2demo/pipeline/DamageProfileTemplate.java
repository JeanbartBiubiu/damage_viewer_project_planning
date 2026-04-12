package xyz.game.enginev2demo.pipeline;

import java.util.Objects;

/**
 * 伤害 profile 模板。
 * 只保留稳定的 profile code 和两条公式引用，不再夹带属性 key。
 */
public record DamageProfileTemplate(
        String damageProfileId,
        String effectiveResistanceFormulaId,
        String mitigationMultiplierFormulaId) {

    public DamageProfileTemplate {
        Objects.requireNonNull(damageProfileId, "damageProfileId");
        Objects.requireNonNull(effectiveResistanceFormulaId, "effectiveResistanceFormulaId");
        Objects.requireNonNull(mitigationMultiplierFormulaId, "mitigationMultiplierFormulaId");
    }
}
