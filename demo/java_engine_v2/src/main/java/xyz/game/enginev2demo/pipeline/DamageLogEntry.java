package xyz.game.enginev2demo.pipeline;

import xyz.game.enginev2demo.api.EngineLogEntry;

/**
 * 伤害结算日志条目。
 */
public record DamageLogEntry(
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
        String critType) implements EngineLogEntry {

    @Override
    public String type() {
        return "damage";
    }
}
