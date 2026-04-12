package xyz.game.enginev2demo.pipeline;

/**
 * 伤害结算完成事件。
 */
public record DamageResolvedEvent(
        long timeMs,
        String sourceActorId,
        String targetActorId,
        String actionId,
        String label,
        String damageProfileId,
        double rawDamage,
        double dealtDamage,
        double shieldAbsorbed,
        double hpDamage,
        double targetHpBefore,
        double targetHpAfter,
        double effectiveResistance,
        double mitigationMultiplier,
        boolean isCritical,
        double critMultiplier,
        String critType) {
}
